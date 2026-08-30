# Connected Agents — list & revoke

## Problem

A user can connect AI agents / MCP clients (Claude, Cursor, …) to their workbench
account through the MCP OAuth 2.1 server. Each connected agent holds a refresh
token (`oauth_refresh_tokens`) and can mint short-lived access JWTs for `/mcp`.
Today the portal gives the user **no way to see which agents are connected, nor
to cut one off**. This feature adds both: a "Connected Agents" list and a revoke
action.

Scope note — this is the **agent → workbench** OAuth surface
(`oauth_clients` / `oauth_refresh_tokens`), NOT the **workbench → SaaS**
connections (`connections` table), which already have list + disconnect.

## Key mechanics (constraints discovered)

- **Access tokens are stateless JWTs** (HS256, signed by `SESSION_SECRET`, TTL
  `OAUTH_ACCESS_TOKEN_TTL_SECONDS`). They carry no DB row, so they cannot be
  individually invalidated without adding a denylist / per-request grant check.
- **Refresh tokens** live in `oauth_refresh_tokens (token_hash, client_id,
  user_id, scope, expires_at)`. Deleting them stops the agent from renewing.
- **Refresh rotation**: `rotateRefreshToken` deletes the old row and inserts a
  new one on every refresh, so any "age" on the row resets unless preserved.
- **`oauth_clients` are NOT user-scoped** — registered via dynamic client
  registration (DCR); the same `client_id` can be shared by multiple users. The
  user↔agent binding lives only in `oauth_refresh_tokens` / `oauth_auth_codes`.

## Decisions

| Question | Decision |
|----------|----------|
| Revoke immediacy | **Soft** — delete refresh tokens; existing JWTs lapse within one access-token TTL. No `/mcp` hot-path change. |
| List/revoke granularity | **Per `client_id`** (per agent). One row aggregates the user's tokens for that client. |
| Tracking columns | Add **`created_at`** to `oauth_refresh_tokens`, **carried across rotation** so "connected since" survives refreshes. |
| Portal placement | **Section on the existing Dashboard** (next to API key + SaaS connections). |

## Design

### 1. Data model

Migration in `packages/server/src/db.ts`, following the existing
`ALTER TABLE … try/catch (duplicate column name)` migration pattern:

```sql
ALTER TABLE oauth_refresh_tokens ADD COLUMN created_at INTEGER DEFAULT (unixepoch())
```

- `issueRefreshToken` (first issue at consent): rely on the column default.
- `rotateRefreshToken`: read the existing row's `created_at` in the SELECT and
  pass it through to the new INSERT, so "connected since" survives rotation.
  Only a fresh consent / re-login resets it.

### 2. Backend module — `packages/server/src/auth/oauth-server/agents.ts` (new)

```ts
export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];          // union of scopes across the user's rows for this client
  connected_since: number;   // MIN(created_at)
  expires_at: number;        // MAX(expires_at)
}

export function listAgents(userId: string): ConnectedAgent[];
export function revokeAgent(userId: string, clientId: string): number; // rows deleted
```

- `listAgents`: `SELECT` the user's non-expired `oauth_refresh_tokens`
  (`expires_at > unixepoch()`), `LEFT JOIN oauth_clients USING (client_id)` for
  `client_name`, group by `client_id`. `scopes` = union of the space-delimited
  `scope` strings across the grouped rows. Newest `connected_since` first
  ordering (most recent agents at top — use `MIN(created_at)`,
  `ORDER BY connected_since DESC`).
- `revokeAgent`: within a transaction —
  `DELETE FROM oauth_refresh_tokens WHERE user_id=? AND client_id=?` and
  `DELETE FROM oauth_auth_codes WHERE user_id=? AND client_id=?` (kill any
  in-flight authorization codes too). Returns the refresh-token rows deleted.
  **Never** deletes from `oauth_clients` and **never** touches other users' rows.

### 3. Routes — `packages/server/src/api/routes.ts`

Session-authenticated, same as `/api/connections` (uses `request.user`):

- `GET /api/agents` → `{ agents: ConnectedAgent[] }`.
- `DELETE /api/agents/:clientId` → `{ revoked: number }`. Returns
  `{ revoked: 0 }` (200) when the user had no tokens for that client — revoke is
  idempotent; no 404 needed.

### 4. Frontend

- `packages/portal/src/api.ts`: add `listAgents()` and `revokeAgent(clientId)`,
  following the existing `getConnections` / disconnect fetch helpers
  (`getHeaders()`, `API_URL`).
- `packages/portal/src/pages/Dashboard.tsx`: new **"Connected Agents"** section
  beneath the SaaS connections block.
  - `useQuery(["agents"], listAgents)`.
  - Each row: agent name (fall back to `client_id` when `client_name` is
    absent), scope chips, "connected <relative time>", expiry.
  - **Revoke** button → confirm dialog → `useMutation(revokeAgent)` →
    `invalidateQueries(["agents"])`.
  - Empty state: "No agents connected."
  - Helper note under the list: revoking stops the agent from renewing access;
    an in-flight session may keep working for up to the access-token lifetime.

### 5. Error handling

- Backend list/revoke are pure SQLite reads/writes; wrap route handlers in the
  same error envelope the surrounding routes use.
- Revoke of an unknown / already-revoked client returns `{ revoked: 0 }` — not an
  error.
- Unauthenticated requests are rejected by the existing session guard, same as
  `/api/connections`.

### 6. Testing — `packages/server/tests/agents.test.ts`

- **list — grouping**: multiple refresh-token rows for one `client_id` collapse
  to a single agent; `scopes` is the union; `connected_since`/`expires_at` are
  MIN/MAX.
- **list — excludes expired**: an `expires_at` in the past is omitted.
- **list — user scoping**: another user's tokens never appear.
- **revoke — scoping**: deletes only the caller's rows for the target client;
  a second client and another user's rows for the same client are untouched;
  the `oauth_clients` row survives.
- **revoke — in-flight codes**: matching `oauth_auth_codes` rows are also deleted.
- **rotation — created_at preserved**: `rotateRefreshToken` keeps the original
  `created_at` on the new row.

## Out of scope (YAGNI)

- Hard/immediate access-token revocation (denylist or per-request grant check).
- `last_used_at` activity tracking.
- Admin view of all users' agents.
- A dedicated `/agents` route/page (folded into Dashboard instead).
