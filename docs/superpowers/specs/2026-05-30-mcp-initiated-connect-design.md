# MCP-Initiated Connect (Composio Parity)

**Date:** 2026-05-30
**Status:** Design — approved for planning
**Topic:** Let an agent connect a new integration directly from MCP (not only the portal), generating an OAuth consent URL for `oauth2` integrations and a CDP login deep-link for `cookie` integrations.

## Problem

Today an integration can only be connected from the portal:

- The MCP meta-tool `get_auth_url` returns a **relative path** (`/api/auth/<integ>?user=<id>`) and, for cookie auth, only a "open the URL, log in, then confirm" instruction.
- The real login flow lives in the portal: `GET /api/auth/:integration` starts the session and the portal canvas proxies the headless-chromium CDP page so the human can type credentials; the portal then `POST`s `/api/auth/cookie/:integration/capture` to store cookies.
- An agent running in a terminal (Claude Code, etc.) cannot drive that portal canvas, so it cannot get a user connected without the human first going to the dashboard.

Composio solves the same problem with two tools: one returns a redirect/magic URL plus a connection request id, and `WAIT_FOR_CONNECTIONS` blocks until the connection completes. We want parity.

Secondary problem (closes finding `2026-05-30-abandoned-cookie-session-leak`): an abandoned cookie login session leaks a headless-chromium process and a temp `userDataDir` until explicit `closeCookieSession` or server restart — there is no TTL/idle reaper in `auth/cookie.ts`.

## Goals

1. Agent calls one MCP tool to begin connecting any integration; gets back an **absolute, openable URL**.
   - `oauth2` → provider OAuth consent URL.
   - `cookie` → magic-link into the portal CDP login page.
2. Agent calls a second MCP tool to **block until connected** (or timeout/expiry).
3. Abandoned cookie sessions are reaped automatically (no orphan chromium / tmpdir).
4. `get_auth_url` keeps working (thin alias) — no caller breakage.

## Non-Goals

- No change to how cookies are captured/encrypted/attached at exec time.
- No multi-device session sync; the magic link is single-use and short-lived.
- No new auth provider types.

## Design

### 1. MCP tool surface (`mcp/meta-tools.ts`)

Two new meta-tools; `get_auth_url` becomes a thin alias for back-compat.

- **`connect(integration)`** — starts a *pending connection*, returns:
  - `oauth2`: `{ connectionId, type: "oauth2", url }` where `url` is the absolute provider consent URL (existing `buildAuthUrl` / `buildPluginAuthUrl`).
  - `cookie`: `{ connectionId, type: "cookie", url }` where `url = ${config.PORTAL_URL}/connect/<integration>?t=<jwt>`.
- **`wait_for_connection(connectionId, timeoutSec = 300)`** — polls the pending-connection store until status is terminal; returns `{ status: "CONNECTED" | "TIMEOUT" | "EXPIRED" }`. On `TIMEOUT` it also reaps the underlying cookie session.
- **`get_auth_url(integration)`** — calls `connect` internally and returns the same shape it returns today (`{ url, ... }`) so existing callers keep working. Documented as deprecated in favor of `connect`.

### 2. Pending-connection store (`auth/connections.ts`, new)

In-memory `Map<connectionId, PendingConnection>`, unifying both auth types so `wait_for_connection` is type-agnostic.

```ts
interface PendingConnection {
  connectionId: string;       // crypto.randomUUID()
  userId: string;
  integration: string;
  type: "oauth2" | "cookie";
  status: "PENDING" | "CONNECTED" | "EXPIRED";
  createdAt: number;          // unix seconds
  expiresAt: number;          // createdAt + TTL
  cookieSessionId?: string;   // cookie type only — links to auth/cookie session
}
```

Lifecycle:

- `connect` creates a `PENDING` record. For `cookie` it first calls `startCookieSession(...)` and stores the returned `sessionId` in `cookieSessionId`.
- Status flips to `CONNECTED` when the connection's token/cookies land:
  - `cookie`: the capture endpoint (`POST /api/auth/cookie/:integration/capture`), after `storeCookies`, marks the matching pending record `CONNECTED`.
  - `oauth2`: the OAuth callback handler, after `storeToken`, marks the matching pending record `CONNECTED`.
- `wait_for_connection` reads `status` on an interval (e.g. poll every 1s up to `timeoutSec`).

Matching a callback/capture back to a pending record: by `(userId, integration)` with the newest `PENDING` record, since a user has at most one in-flight connect per integration.

### 3. One-time magic-link token

- `connect` (cookie path) mints a short JWT with `jose` HS256 signed by `config.SESSION_SECRET`, audience `a-workbench-connect` (distinct from the `a-workbench` session audience so a connect token can never be used as a session), payload `{ connectionId, userId, sessionId, exp }`, expiry = TTL (10 min).
- New portal route `GET /connect/:integration?t=<jwt>` — a public page that:
  1. Verifies the JWT (audience `a-workbench-connect`, not expired).
  2. Uses the embedded `sessionId` + the existing CDP proxy (`/api/auth/cookie/:integration/cdp`) to render the login canvas — no prior portal login required.
  3. On the user finishing login, calls the existing capture endpoint with `sessionId`.
- Token is single-use: consumed when capture succeeds (record flips `CONNECTED`) or when the session expires. Server-side validation: capture is gated by the live cookie session existing; once `closeCookieSession` runs, the token is dead.

Helpers live in `auth/connect-token.ts` (`signConnectToken`, `verifyConnectToken`), mirroring `auth/session.ts`.

### 4. Reaper — closes the abandoned-session leak

- TTL default **10 min** (`expiresAt`).
- A single `setInterval` sweep (e.g. every 60s) over the pending-connection store: any `PENDING` record past `expiresAt` →
  - if `cookieSessionId`, call `closeCookieSession(sessionId)` (SIGKILL chromium + `rm` tmpdir),
  - mark the record `EXPIRED`,
  - drop the record after a short grace so a late `wait_for_connection` can still read `EXPIRED`.
- `wait_for_connection` TIMEOUT path also triggers the same reap immediately for that connection.
- Reaper started once at server boot; cleared on shutdown.

### 5. Config

- Reuse existing `config.PORTAL_URL` as the magic-link base (the portal serves `/connect`). No new env var.
- Reuse `config.SESSION_SECRET` for the connect-token signature (distinct audience).

## Data Flow (cookie, from MCP)

1. Agent → `connect("jira")`.
2. Server: `startCookieSession` spawns headless chromium; create `PENDING` record; mint JWT; return `{ connectionId, url: <PORTAL_URL>/connect/jira?t=… }`.
3. Agent shows `url` to the human; calls `wait_for_connection(connectionId)`.
4. Human opens `url` → portal `/connect/jira` verifies JWT, shows CDP canvas, human logs in.
5. Portal → capture endpoint → `storeCookies` → pending record flips `CONNECTED`.
6. `wait_for_connection` returns `CONNECTED`; agent proceeds to call real tools (exec-time guard now passes).

OAuth2 differs only in steps 2/4/5: `url` is the provider consent URL; the OAuth callback flips the record `CONNECTED`.

## Error Handling

- Unknown integration → `connect` returns `{ error: "Integration not found" }` (current behavior).
- Expired/invalid JWT at `/connect` → portal shows "link expired, ask the agent to reconnect."
- `wait_for_connection` on unknown `connectionId` → `{ error: "Unknown connectionId" }`.
- `wait_for_connection` timeout → `{ status: "TIMEOUT" }` + reap.
- Reaper failures (kill/rm) are swallowed (best-effort), matching existing `closeCookieSession`.

## Testing

- Pending-store lifecycle: create → connect (cookie + oauth2) → terminal status.
- Connect-token: mint/verify round-trip; wrong audience rejected; expired rejected; single-use (dead after session close).
- Reaper: a `PENDING` past `expiresAt` triggers `closeCookieSession` and flips `EXPIRED`; verify chromium spawn is killed (mock `spawn`).
- `wait_for_connection`: resolves `CONNECTED` when capture marks the record; resolves `TIMEOUT` and reaps when it elapses.
- `connect`: returns absolute `PORTAL_URL`-based link for cookie, provider URL for oauth2.
- `get_auth_url` alias still returns the legacy shape.

## Open Questions

None — TTL fixed at 10 min; `get_auth_url` retained as alias.
