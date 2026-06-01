# a-workbench v0.4.1

_2026-06-01_

Patch: **route the cookie-auth capture browser through a proxy**, so an in-cluster capture can reach login providers that reject the host's egress IP.

## Why
Some providers reject interactive sign-in from datacenter IPs — notably **Google SSO returns a generic 500 to OAuth sign-in from cloud/datacenter egress** (the same capture works from a residential IP). An in-cluster capture (e.g. GKE) therefore can't complete a Google-SSO login. These two env vars let the capture browser exit via a clean (residential/ISP) IP.

## Features
- **`CAPTURE_PROXY`** — proxy for the capture chromium, e.g. `socks5://host:1080` or `http://host:3128`. Unset → direct (unchanged).
- **`CAPTURE_PROXY_USERNAME` / `_PASSWORD`** — credentials for an **authenticated HTTP** proxy. Chromium can't take proxy creds on the CLI (and can't auth SOCKS5 at all), so they're supplied via the CDP `Fetch.authRequired` challenge — answering PROXY challenges only, never the site's own auth.

## Notes
- For an authed **SOCKS5** proxy, use the provider's **IP-authorization** instead (whitelist the egress IP) — chromium can't do SOCKS5 user/pass auth.
- Residential rotating proxies: pin a **sticky session** so the whole OAuth flow (app → provider → back) stays on one IP.
- Tests: 265 passing.

---

# a-workbench v0.4.0

_2026-05-31_

Headline: **cookie-auth actually works in the Docker image** (it was fully broken), plus **batch tool execution** and a **Drive query-injection fix**.

## Features
- **`execute_tools`** — new MCP meta-tool: run many tools in one call, bounded-concurrent, results returned in input order, a single failure isolated to its slot (parity with Composio's `MULTI_EXECUTE_TOOL`). Cuts per-tool round-trips.
- **`get_tool_schema` returns portable JSON Schema** (via `zod-to-json-schema`) instead of raw Zod internals — any MCP client can consume it.

## Security
- **Drive query injection** — user `query` was interpolated unescaped into the Drive `q` parameter (`google-docs` / `google-slides` / `google-drive` search), allowing query manipulation (e.g. reading trashed files). Now backslash-escapes `\` and `'`.

## Fixes
- **Cookie-auth capture was broken in the image** — chromium's zygote refuses to run as root without `--no-sandbox`, so the CDP endpoint never came up and Connect failed (`fetch failed`). Added `--no-sandbox` + `--disable-dev-shm-usage`.
- **Cookie replay scoping** — `ctx.http` replayed *all* captured cookies to *every* host; on multi-subdomain logins this bloated the header (upstream `400 Request Header Or Cookie Too Large`) and broke host-specific auth. Now scopes cookies to the target host like a browser.
- **Cookie liveness** — a connection was marked dead if *any* single cookie expired (short-lived SSO/analytics cookies poisoned otherwise-valid sessions). Now dead only when no live cookie remains; already-expired cookies are dropped at capture.
- **`google_slides_create_from_markdown`** created blank slides and discarded the text — now adds a text box + `insertText` per slide.
- **Drive `orderBy`** — `"modifiedTime desc"` 400'd because the space was sent as `+`; now sent as `%20`.
- **docker-compose** — `env_file: .env` so Google SSO + per-plugin OAuth creds reach the container (`/authorize` previously 500'd with "GOOGLE_CLIENT_ID not configured"); container-specific `PORT`/`NODE_ENV`/`DATABASE_URL` overrides.

## Chores / Docs
- New dependency: `zod-to-json-schema` (server).
- CI/release workflows run JavaScript actions on Node 24 (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`).
- Docs: `execute_tools` + JSON-Schema in architecture/how-to-use; step-by-step Claude Code connect + troubleshooting; findings `root-chromium-no-sandbox`, `cookie-domain-scoping`.
- Tests: 259 passing.

## Notes
- Cookie-auth (incl. multi-subdomain SSO logins) verified end-to-end in-container this cycle. Anyone on ≤ v0.3.0 using cookie integrations in Docker should upgrade — it did not work before.

---

# a-workbench v0.3.0

_2026-05-31_

Headline: **MCP OAuth 2.1 authorization** — MCP clients (Claude Code, etc.) connect to `/mcp` with no pasted key; on first connect a browser opens for Google SSO. Plus first-class **API keys** and a richer **integration registry** (logos, descriptions, tool browser).

## Features

### MCP OAuth 2.1 (browser login)
- a-workbench is now an OAuth Authorization + Resource Server for `/mcp`.
- Discovery: `/.well-known/oauth-protected-resource` (RFC 9728) + `/.well-known/oauth-authorization-server` (RFC 8414).
- Dynamic Client Registration (`POST /register`, public clients, RFC 7591).
- `GET /authorize` — PKCE S256, validates `redirect_uri`, delegates user auth to the existing Google SSO via a state-ticket round-trip; flow bound to the originating browser (httpOnly cookie).
- `POST /token` — authorization_code (PKCE) + refresh_token (rotating) grants.
- `/mcp` accepts an OAuth `Authorization: Bearer` access token; a no-token request returns a JSON-RPC 401 with `WWW-Authenticate: Bearer … resource_metadata=…`.

### MCP API keys
- Mint/rotate/revoke a long-lived API key from the portal (shown once, masked, bcrypt-hashed at rest).
- Authenticated via the dedicated **`x-workbench-api-key`** header (for headless clients); `Authorization: Bearer` is reserved for OAuth/session tokens.

### Integration registry UX
- Plugin manifests gain optional `displayName`, `description`, `logo`, `categories`.
- Portal cards show brand logos (served from each plugin dir, generic cog fallback), descriptions, a category filter, and a detail view listing each integration's tools.
- New endpoints: enriched `GET /api/integrations`, `GET /api/integrations/:name`, public `GET /api/integrations/:name/logo`.

## Fixes
- Google SSO callback uses `SERVER_PUBLIC_URL` (was `PORTAL_URL`) — SSO works when portal/server differ.
- Bind the OAuth resume ticket to the originating browser (login-CSRF / auth-code injection).
- Exclude `/.well-known` from the portal SPA fallback so discovery never returns HTML.
- `/mcp` 401 now a JSON-RPC error envelope, not a bare body.

## Chores / Internal
- New env: `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (default 3600).
- Serialized vitest files (shared SQLite) to remove a cross-file race.
- Docs: OAuth browser flow, plugin presentation metadata + logo convention, finding `2026-05-31-mcp-oauth`.
- Tests: 247 passing; OAuth core ~98% statement coverage.

## Notes
- The full browser round-trip needs Google SSO configured (`GOOGLE_CLIENT_ID`/`_SECRET`) + an OAuth-capable MCP client.
- Known follow-ups: `resource` parameter (RFC 8707) stored but not enforced; DCR is open/unbounded; tests share the dev SQLite DB.

---

# a-workbench v0.2.1

_2026-05-30_

Patch: **the portal is now served by the server.** v0.2.0 baked the built portal
into the image at `/app/portal` but nothing served it, and the `/connect`
magic-link pointed at the dev server — so the UI (incl. the new connect page) was
unreachable from the image.

## Fixes
- Serve the built portal as static files from the server with SPA fallback: any
  non-API/MCP GET resolves to `index.html`, so client routes like
  `/connect/:integration` load on direct navigation. API/MCP 404s stay JSON.
  (`@fastify/static`, new `PORTAL_DIST_DIR`, default `./portal`.)
- `docker-compose.yml`: default `PORTAL_URL` / `SERVER_PUBLIC_URL` to the server
  origin so portal + connect magic-link URLs resolve out of the box.

---

# a-workbench v0.2.0

_2026-05-30_

Headline: **MCP-initiated connect** — agents can drive a user through cookie/OAuth auth via a public magic-link page, without leaving the MCP session.

## Features
- Public `/connect` magic-link page for cookie auth initiated from MCP.
- `connect` + `wait_for_connection` MCP tools (plus `get_auth_url` alias).
- Connect session/capture endpoints; mark connections `CONNECTED`; start reaper.
- Single-use connect-token sign/verify.
- Pending-connection store + cookie-session reaper; prune terminal records past the grace window.

## Fixes
- Plugin loader: resolve `PLUGINS_DIR` to an absolute path and skip built-in-named dirs — eliminates 14 `ERR_MODULE_NOT_FOUND` errors on container boot (found validating the release image; plugins loaded fine but spammed the log). See `docs/findings/2026-05-30-relative-plugins-dir-import.md`.
- Reject cookie capture with zero cookies instead of marking `CONNECTED`.
- Accept connect JWT for CDP screencast WS auth on the public connect page.
- `wait_for_connection` ownership check; clean up cookie-session on connect failure.

## Chores / Internal
- Single source of truth for MCP meta-tools + schemas; tighten meta-tool types; stop swallowing `safeParse` errors.
- Connect/capture ownership + session 404 test coverage.
- New env documented: `SESSION_SECRET`, `ENCRYPTION_KEY`, `CONNECT_TTL_SECONDS`.

## Release validation
- Docker image built + booted locally: `npm ci` + build succeed, container boots clean (0 plugin errors), 14 integrations / 80 tools register, headless chromium baked in for cookie capture.

---

# a-workbench v0.1.0

First tagged release. Self-hosted MCP tool aggregator for AI agents — connects to SaaS tools via per-user auth, extensible via a plugin SDK.

## Features

### Core server + MCP
- Fastify + MCP TypeScript SDK server exposing `POST /mcp` with the Composio-style meta-tools (`search_tools`, `get_tool_schema`, `execute_tool`, `list_integrations`, `get_auth_url`).
- MCP `initialize` / `notifications` handshake; `execute_tool` validates args against each plugin's schema.
- Dynamic plugin loader (built-ins + external `PLUGINS_DIR`), per-plugin registry.
- OpenTelemetry tracing (resilient init).

### Auth
- Per-user OAuth 2.0 flows with per-plugin OAuth clients (no shared creds); automatic access-token refresh, `offline_access` on Atlassian.
- Google SSO portal login (OIDC), session JWT (sign/verify, aud/iss claims, clock tolerance), API-key auth on `/mcp`.
- Cookie-based auth with human-in-the-loop: server proxies a headless-chromium WebCDP login flow; cookies restricted to declared domains.
- Atlassian `cloud-id` placeholder auto-resolved in `ctx.http`.

### Plugins
- Google Workspace split into per-product plugins: Gmail, Drive, Sheets, Calendar, Gemini, Docs, Slides.
- Atlassian Jira + Confluence (correct scopes), Bitbucket, Asana, GitHub, Slack (messages, channels, history, upload, reactions, threads, user lookup, DMs).
- `httpbin-cookie` reference plugin for cookie auth.

### Portal
- Operator-console redesign (mono + mauve palette), React Router with auth guards, AuthContext session management, Google Sign-In, Connect/login flows wired to backend.

## Fixes
- Security: cookie auth restricted to declared domains, CSWSH closed, `cdpToken` removed from URL, iframe sandbox tightened.
- Plugin loader: `.ts` extension on dynamic imports; tsx compat.
- Migrated two deprecated Jira/Confluence endpoints.
- Auth hardening: state+nonce validation on Google OAuth, expired-nonce pruning, nullable `api_key_hash` handling.
- Dockerfile, Google SSO path, OTel v2 compat.

## Chores / Docs
- Test coverage ~27% → 95.64%; CI + Codecov.
- Docs: architecture, how-to-use, how-to-onboard, how-to-add-custom-plugin, per-provider OAuth guides, UAT reports.
- Docker Compose setup + sample OAuth app.
- Docker image: Debian (glibc) base with Playwright chromium + system libs baked in, so the cookie-auth WebCDP capture flow runs headless in-container.
