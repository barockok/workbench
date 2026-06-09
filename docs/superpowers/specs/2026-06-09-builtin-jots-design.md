# Built-in Jots — scratchpad deploy for workbench

_2026-06-09_

## Summary

Add a built-in **jots** feature to workbench: MCP-deployable, password/public-gated
static sites served by the workbench server itself at `/j/<name>/`. Ports the auth
model from [barockok/jotter](https://github.com/barockok/jotter) (scrypt password
hash + self-verifying HMAC cookie) into the existing Fastify server, and replaces
jotter's filesystem co-location assumption with an MCP **deploy** tool that uploads
artifact bytes.

Premise: an agent builds a web artifact in one session, then deploys it to workbench
over MCP and gets a shareable URL. Viewing is account-less; publishing requires an
authenticated workbench user.

## Motivation

Jotter publishes Claude-built artifacts as shareable "jots" but assumes Claude runs
on the same VPS, so a build written into the jots directory is instantly live. With
workbench the agent is an **MCP client elsewhere** — it cannot write files on the
server. The built-in version keeps jotter's auth/serving model but makes deployment
an MCP tool that ships bytes.

## Design (locked)

- **Tenancy:** global flat namespace (jotter-style). No per-user URL namespacing.
- **Auth gate:** per-jot boundary gate. `public` → open. `password` → visitor enters
  the password once; unlock sets a path-scoped cookie that authorizes **every path**
  under that jot (Cloudflare-zero-trust shape). No session store, no DB rows.
- **Co-location dropped:** deployment is an MCP tool that uploads a file tree.
- **Ownership:** writes are creator-locked; viewing is account-less.

## Components

### 1. Storage

- New config `JOTS_DIR` (default: `<dir of DATABASE_URL>/jots`). Created on boot if missing.
- Each jot is a subdirectory `<JOTS_DIR>/<name>/` containing the deployed file tree
  plus a `jot.json` manifest that is **never served**.
- Manifest shape:
  ```json
  {
    "access": "public" | "password",
    "hash": "scrypt$<saltHex>$<hashHex>",   // present only when access=password
    "owner": "<userId>",
    "createdAt": "<ISO>",
    "updatedAt": "<ISO>"
  }
  ```

### 2. Serving (Fastify routes)

Registered **before** `registerPortal` — the portal owns the `/` SPA catch-all, so
jot routes must match first.

- `GET /j/:name/*` — boundary gate, then static file serve:
  - validate name (`^[a-z0-9][a-z0-9-]*$`, ≤64); 404 if invalid or no such jot dir/manifest.
  - `public` → serve directly.
  - `password` → require a valid `jot_<name>` cookie. Missing/invalid:
    - HTML navigation request → `200` unlock page.
    - other (fetch/XHR/asset) → `401`.
  - resolve file inside the jot dir with a traversal guard (`resolveInside`); empty
    path / trailing slash → `index.html`; directory → its `index.html`. Reject any
    path whose basename is `jot.json`.
- `POST /j/:name/__auth` — password unlock:
  - verify against `manifest.hash` (timing-safe scrypt).
  - wrong → `401` unlock page with error.
  - right → set cookie and 302 to `/j/<name>/`:
    - `jot_<name>=HMAC(secret, name)`, `Path=/j/<name>/`, `HttpOnly`, `SameSite=Lax`,
      `Max-Age=2592000`, `Secure` when `NODE_ENV==="production"`.
- **Secret:** reuse the existing `SESSION_SECRET` config (already ≥32 chars, stable
  across restarts). No new secret env.

### 3. Ported jotter modules (TypeScript, under `packages/server/src/jots/`)

- `auth.ts` — `hashPassword`, `verifyPassword` (scrypt, self-describing
  `scrypt$salt$hash`), `makeToken`/`verifyToken` (HMAC-SHA256, timing-safe),
  `cookieName(name)` → `jot_<name>`.
- `paths.ts` — `isValidJotName`, `parseRequestPath` (adapted to strip the `/j/`
  prefix), `resolveInside` (traversal guard, blocks `jot.json` basename), `MANIFEST`.
- `mime.ts` — extension → content-type map (ported as-is).
- `store.ts` — manifest read/write, owner checks, atomic tree replace, deletion,
  per-owner listing.

### 4. MCP meta-tools (`packages/server/src/mcp/meta-tools.ts`)

- `deploy_jot({ name, files, access, password? })`
  - `files`: array of `{ path: string, content: string, encoding?: "utf8" | "base64" }`.
  - validate: name regex; each `path` relative, no `..`, no leading `/`, basename ≠
    `jot.json`; non-empty array; total decoded bytes ≤ `JOTS_MAX_BYTES`.
  - `access:"password"` requires `password` (hashed with scrypt at deploy).
  - ownership: if the jot exists and `manifest.owner !== ctx.userId` → `{ error: "JOT_NAME_TAKEN" }` (403-equivalent).
  - write to `<name>.tmp/` then atomically rename over `<name>/` (wholesale replace —
    old files for an owned overwrite are gone).
  - returns `{ name, access, url }` where url = `<SERVER_PUBLIC_URL>/j/<name>/`.
- `list_jots()` → the caller's own jots (`owner === ctx.userId`):
  `{ name, access, url, updatedAt }[]`.
- `delete_jot({ name })` → owner only; else `{ error: "FORBIDDEN" }`. Removes the tree.

Add matching wire schemas to `metaToolSchemas`.

## Authorization matrix

| Action | Condition | Result |
|--------|-----------|--------|
| deploy `name` | name free | create; `owner = userId` |
| deploy `name` | exists, `owner == userId` | overwrite tree wholesale |
| deploy `name` | exists, `owner != userId` | `JOT_NAME_TAKEN` |
| delete `name` | `owner == userId` | deleted |
| delete `name` | `owner != userId` | `FORBIDDEN` |
| view `/j/name/…` | access=public | served, no auth |
| view `/j/name/…` | access=password, valid cookie | served |
| view `/j/name/…` | access=password, no/invalid cookie | unlock page (HTML) / 401 |

Viewing never requires a workbench account. Deploy/delete require an authenticated MCP
user (`ctx.userId`, already supplied by the api-key / OAuth-Bearer path on `/mcp`).

## Config (new)

- `JOTS_DIR` — string, default `<dir of DATABASE_URL>/jots`.
- `JOTS_MAX_BYTES` — coerced int, default `5_242_880` (5 MB) total decoded bytes per jot.

Cookie `Secure` flag derives from `NODE_ENV === "production"`. Secret reuses
`SESSION_SECRET`.

## Security

- **Path traversal:** `resolveInside` resolves the target and rejects anything outside
  the jot dir; deploy-side path validation rejects `..` / absolute / `jot.json` before
  any write.
- **Manifest never served:** any request path whose basename is `jot.json` → rejected.
- **Timing-safe compares** for both password (scrypt) and cookie token (HMAC).
- **Cookie scope:** `Path=/j/<name>/` — a cookie for one jot can't open another.
- **Disk abuse:** per-jot total size cap; empty deploys rejected.
- **No account leak via viewing:** the public serve path never reads workbench user
  state.
- **Same-origin untrusted content (added during implementation):** jots serve
  user-uploaded HTML/JS on the **same origin** as the authenticated portal / `/api` /
  `/mcp`, so without isolation a malicious jot's script could reach app cookies and
  call app APIs as the viewer. Mitigation: every jot/unlock response carries
  `Content-Security-Policy: sandbox allow-scripts allow-forms` (forces a unique opaque
  origin — jot JS can't read app cookies/storage or make credentialed same-origin
  requests), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Cross-Origin-Resource-Policy: same-origin`. **Trade-off:** an opaque-origin jot
  cannot `fetch()` its own data files, so jots must be self-contained (inline JS/CSS;
  `<script>`/`<link>`/`<img>` to its own files still load). A future upgrade for
  data-fetching jots is to serve them from a separate cookie-less origin
  (`*.jots.<host>`) with app cookies scoped to the app host — left out of scope here.

## Testing

- `auth.ts` — hash/verify round-trip, wrong password, token make/verify, tamper.
- `paths.ts` — name validation, `parseRequestPath` with `/j/` prefix, `resolveInside`
  traversal (`..`, absolute, `jot.json`) rejection.
- `store.ts` — create, owned overwrite (old files gone), `JOT_NAME_TAKEN`, delete
  owner-lock, listing by owner, size cap, atomic-rename leaves no `.tmp` on failure.
- serve routes — public open; password gate (`401` for fetch, unlock page for HTML);
  unlock flow sets correctly-scoped cookie; cookie for jot A rejected on jot B;
  traversal `403/404`; `jot.json` hidden; mime types.
- deploy tool — happy path returns url; validation errors (bad name, bad path,
  password missing, oversize, empty); ownership conflict.

## Out of scope (YAGNI)

- Per-user URL namespacing or subdomains.
- Portal UI for managing jots (listing/delete from the dashboard) — `list_jots` /
  `delete_jot` MCP tools cover it for now.
- Versioning / rollback, custom domains, analytics, per-jot CSP tuning.
- Changing access/password without a full re-deploy (re-deploy covers it).
