# Changelog

All notable changes to a-workbench, newest first. The latest release also lives in `RELEASE_NOTES.md`.

---

# a-workbench v0.10.2

_2026-06-10_

Headline: **Cookie connect always re-verifies login**, plus a **static out-of-band OAuth redirect page** for CLI agents.

## Changes
- **Cookie-auth connect always opens the login live view.** A v0.10.0 regression: after disconnecting a cookie integration and reconnecting, the "smart capture" fast-path instantly marked it connected from cookies still present in the shared browser session — even though disconnect only deletes the *stored* cookies, not the browser session's, so a stale/invalid session could silently reconnect. Connect now always prompts login (the instant fast-path is removed from both the portal route and MCP `startConnect`); the user logs in and clicks Capture. The Capture flow and `captureLiveCookies` are unchanged.
- **Static `GET /oauth/callback` out-of-band redirect landing page.** For CLI agents that can't host a redirect listener: the OAuth provider redirects to this generic, no-auth page, which shows the full redirect URL (verbatim, including `?code&state`) with a Copy button. The user pastes it back to the agent, which does the code exchange itself — workbench does no server work. Hardened: the URL reaches the DOM only via `input.value` (no HTML sink), `CSP: default-src 'none' … frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Pointing plugin `redirect_uri`s at this page and the agent-side tool that consumes the pasted URL are follow-ups.

## Notes
- Tests: 412 passing. Same pre-existing/flaky suite failures as prior releases (`loader.test.ts` ×2; `users.test.ts` shared-SQLite race) — unrelated; both PRs passed CI clean.

---

# a-workbench v0.10.1

_2026-06-10_

Headline: **Fix cookie capture 400** — capturing a cookie-auth session from the portal no longer fails with `FST_ERR_CTP_EMPTY_JSON_BODY`.

## Fixes
- **Cookie capture/cancel returned 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.** A v0.10.0 regression: the browser-session unification dropped the now-dead `{ sessionId }` body from the `/api/auth/cookie/:integration/capture` and `.../cancel` POSTs but left them declaring `Content-Type: application/json`, which Fastify rejects when the body is empty. Both requests now use the bodyless `authHeaders()` helper (Authorization only, no content-type) — the same one `disconnectIntegration` uses. See `docs/findings/2026-06-10-empty-json-body-bodyless-post.md`.

---

# a-workbench v0.10.0

_2026-06-10_

Headline: **One per-user browser session** — browser-use driving and cookie capture now share a single Chromium, so connecting a cookie integration after logging in via the live view just works.

## Features
- **Unified browser session.** Previously cookie capture and the browser-use live view each spawned their own Chromium on the user's one profile dir; whichever started first held the `activeProfiles` lock and the other failed with `BROWSER_SESSION_BUSY`. Now `browser-session.ts` owns a single per-user Chromium that both flows operate on.
- **Smart capture.** Connecting a cookie integration reads cookies from the shared session: if you're already logged into the target site (e.g. via `browser_live_url`), it captures them instantly and marks the integration connected — no second login. Otherwise it opens a login live view; you log in and click **Capture**. The portal honors the new `status: "connected" | "login_required"` contract.
- **Capture is a pure read.** Cookie capture is now `Storage.getCookies` over the shared session's CDP endpoint, filtered to the integration's domains. It never spawns a second browser and never tears the session down — the idle reaper owns Chromium lifecycle.

## Fixes
- **Proxy-auth for browser-use sessions.** Proxy `Fetch.authRequired` challenges were only answered on the old cookie-capture path, so browser-use through an authenticated `CAPTURE_PROXY` couldn't authenticate. `ensureSession` now wires proxy-auth for the shared session.

## Security
- **Cookie CDP proxy connect-JWT is scoped to its route integration.** With both proxies sharing one per-user session map, the cookie proxy now requires a connect JWT's `integration` to match the route's `:integration` (the browser proxy already pins `__browser__`), blocking cross-proxy / `__browser__` token replay. The auth-frame validation is extracted into `authorizeCdpFrame` with unit tests covering the accept and reject paths (including cross-proxy replay in both directions).

## Chores
- Removed ~489 lines of dead per-capture session code from `cookie.ts`; it is now storage + a pure, unit-tested `filterCookies` + proxy-auth helpers. The `sessionId` identifier collapses to `userId` across connect JWTs, both CDP proxies, and the portal WS auth frame.

## Notes
- Tests: 414 passing. Three suite failures are pre-existing and unrelated to this release: `loader.test.ts` ×2 (fail at the prior tag) and `users.test.ts` ×2 (the shared-SQLite race documented in `vitest.config`; passes in isolation, non-deterministic across runs).

---

# a-workbench v0.9.2

_2026-06-09_

Headline: **Browser capture survives pod rollouts** — a stale Chromium profile lock left by a dead pod no longer blocks the next one.

## Fixes
- **Clear stale Chromium `Singleton*` locks before launch.** Chromium guards a `--user-data-dir` with `SingletonLock` (a `<host>-<pid>` symlink), `SingletonSocket`, and `SingletonCookie`. When the profile lives on a persistent/shared volume and a pod dies uncleanly (OOM, SIGKILL, rolling deploy), those files survive and name a host that no longer exists — so the next pod's Chromium exits with code 21 (`profile appears to be in use … on another computer`) before DevTools comes up, surfacing as a 500 on capture / warm-browser launch. `spawnProfileChromium` now removes the three `Singleton*` files immediately before spawn; since same-process sessions are already serialized via `activeProfiles`, any lock present is stale by definition.

## Notes
- This fixes the stale-after-death case only. It does **not** make two *live* replicas driving one user's profile concurrently safe. See `docs/findings/2026-06-09-chromium-singleton-lock-stale.md`.
- Tests: 412 passing (409 server + 3 shared).

---

# a-workbench v0.9.1

_2026-06-09_

Headline: **Jot uploads now require a root `index.html`** — a deploy that would silently serve nothing is rejected up front.

## Features
- **`deploy_jot` rejects an upload with no root `index.html`.** A jot is served at `/j/<name>/`, which resolves to the root `index.html`; an archive lacking one used to publish a jot that silently 404s. The upload route now returns **400 `{ error: "NO_INDEX" }`** when the extracted root has no `index.html`, leaving any existing jot untouched. The `deploy_jot` tool description and the how-to-use docs state the requirement.

## Notes
- Enforcement is scoped to the upload route, so the internal `deployJot` seed helper (and jots that are intentionally served only at explicit sub-paths in tests) are unaffected.
- Tests: 410 passing (407 server + 3 shared).

---

# a-workbench v0.9.0

_2026-06-09_

Headline: **`deploy_jot` is now a tar.gz upload** — deploy a jot by uploading a gzip tarball to a returned URL instead of stuffing the whole file tree through the MCP call.

## ⚠️ Breaking change
- **`deploy_jot` no longer accepts `files[]`.** It now takes `{ name, access, password? }`, validates up front, and returns `{ uploadUrl, token, expiresAt, maxBytes }`. Package your site directory and upload it as a gzip tarball: `tar czf - -C <dir> . | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. Agents/clients still using the inline-`files[]` shape must switch to the two-step flow. The MCP wire schema is updated accordingly.

## Features
- **Two-phase jot deploy via tar.gz upload.** `deploy_jot` mints a single-use upload token (~5 min TTL, 256-bit, owner-bound server-side) and returns its URL. `POST /j/upload/:token` streams the archive through `gunzip → tar-stream` into a staging dir and publishes it atomically. This keeps large/binary/multi-file artifacts out of the MCP JSON-RPC channel.
- **Hardened extraction.** Each entry is validated: path-traversal/absolute/NUL/manifest names rejected (`safeRelPath`), only regular files and directories allowed (symlinks/hardlinks/devices rejected — no tar-slip escape), decompressed size capped mid-stream (≤5 MiB, zip-bomb-safe), and a ≤1000-file cap. A failed upload leaves any existing jot untouched.

## Notes
- New config: `JOTS_MAX_FILES` (default 1000), `JOTS_UPLOAD_TTL_SECONDS` (default 300). `JOTS_MAX_BYTES` unchanged (5 MiB decompressed). New dependency: `tar-stream`.
- Ownership/access/password are bound at `deploy_jot` time and cannot be overridden by the upload body. Serving is unchanged (sandboxed opaque-origin CSP; password-cookie binding from v0.8.1).
- Security review: clean (no findings). Tests: 409 passing (406 server + 3 shared).
- Docs updated: `architecture.md` (meta-tools row), `how-to-use.md` (Deploying a jot).

---

# a-workbench v0.8.2

_2026-06-09_

Headline: **Cookie-capture failures now say why** — when the capture Chromium can't start, the error names the real cause instead of an opaque DevTools timeout.

## Fixes
- **Surface the real reason a capture Chromium fails to launch.** Cookie-auth capture spawns a headless Chromium and polls its DevTools port; if Chromium died on startup the request previously failed with a generic `Failed to reach http://127.0.0.1:<port>/json/version: fetch failed` after a 4s timeout, with the cause discarded (`stdio: "ignore"`). The spawner now captures Chromium's stderr (last 4 KB), detects an early process `exit` (code/signal) and `spawn` errors, and fails fast with a concrete message — e.g. `chromium exited (signal SIGKILL) before DevTools came up. stderr: …` (OOM), namespace/seccomp errors, missing libs, or an unwritable profile dir. A failed launch also SIGKILLs the process so a half-alive Chromium can't leak.

## Notes
- Diagnostics only — no behavior change on the success path. This does not itself fix an environment that can't run Chromium (e.g. a too-tight pod memory limit, restrictive seccomp/`readOnlyRootFilesystem`, or an unwritable `BROWSER_PROFILES_DIR`); it makes that cause visible in the logs so it can be fixed in the deployment.
- Tests: 383 passing (380 server + 3 shared).

---

# a-workbench v0.8.1

_2026-06-09_

Headline: **Password jots actually unlock now** — fixes a v0.8.0 bug where every password was rejected, and hardens per-jot authorization.

## Fixes
- **Password jots were impossible to unlock.** A content-type-parser collision (boot order: the OAuth route group registers the `application/x-www-form-urlencoded` parser first, yielding an object) meant the jot unlock handler read `req.body` as a string that was never there, so the submitted password was always empty and every attempt returned "Wrong password". The `__auth` handler now reads the password from either body shape (raw string or parsed object).

## Security
- **Unlock cookies are now bound to the jot's current password.** The per-jot cookie token is `HMAC(secret, name + passwordHash)` instead of `HMAC(secret, name)`. Rotating a jot's password (re-deploy with a new password) immediately invalidates every previously issued unlock cookie. Per-jot isolation is unchanged and reaffirmed: opening multiple password jots in one browser keeps each authorized only by its own password (distinct `Path`-scoped, name+hash-bound cookies).

## Notes
- Tests: 383 passing (380 server + 3 shared). New coverage: object-body unlock (regression), password-rotation invalidation, two-jots-one-session independence.

---

# a-workbench v0.8.0

_2026-06-09_

Headline: **Disconnect what you connect** — drop an integration's stored credentials straight from the portal. Plus a browser-use integration card, built-in jot scratchpad deploys, and a `whoami` MCP tool.

## Features
- **Disconnect connected apps.** New `DELETE /api/connections/:integration` (session-auth, scoped to your own user) removes stored credentials — the OAuth token for oauth2 integrations, the captured cookies for cookie integrations. The portal exposes a **Disconnect** button on each connected card and in the integration detail modal, with a confirm dialog. The built-in browser is guarded (400) and unknown integrations 404. Cookie integrations keep their warm browser profile — clear that separately with **Clear session**.
- **Browser-use as an integration card.** The built-in warm-Chromium browser now surfaces in the registry as a first-class, always-on integration card instead of a separate panel.
- **Jot scratchpad deploys.** `deploy_jot` / `list_jots` / `delete_jot` publish a static web artifact as a public/password-gated site at `/j/<name>/`. Global namespace, creator-locked writes, account-less viewing; jot pages are sandboxed (CSP opaque origin) so they can't reach app cookies/APIs.
- **`whoami` MCP tool.** Returns the current authenticated user (id + email) — identity only, not connected integrations.

## Notes
- Docs updated: `how-to-use.md` (Disconnecting an integration; browser tools), `architecture.md` (meta-tools: `whoami`, jot tools).
- Disconnect is per-user and scoped server-side to the authenticated session — a user cannot drop another user's connection.
- Tests: 380 passing (377 server + 3 shared).

---

# a-workbench v0.7.0

_2026-06-08_

Headline: **API keys are retrievable again** — minted keys are no longer shown only once. Plus friendlier cookie import and a clearer integration registry.

## Features
- **Revealable API keys.** The MCP access key is now stored encrypted (reversibly) alongside its bcrypt hash, so it can be retrieved after minting instead of shown once. New `GET /api/keys/reveal` (session-auth) and a **Reveal key** button in the portal.
- **Bare-array cookie import.** `POST /api/integrations/:integration/session/import` now accepts a raw cookie array — at the body root (`[...]`) or under `session` — and auto-wraps it into a `{ cookies }` bundle. The existing `{ session: { cookies } }` shape still works.
- **Integration registry sort + gating.** The list reports a `configured` flag per integration (cookie → always; oauth2 → only when client creds are present; otherwise false). The dashboard sorts **live > available > not configured**, and not-configured cards are dimmed and unclickable.

## Notes
- Security tradeoff: the API key is now recoverable from the DB if `ENCRYPTION_KEY` leaks. Consistent with how cookies and OAuth tokens are already stored for this self-hosted, owner-only tool.
- Docs updated: `how-to-use.md` (Reveal key), `how-to-onboard.md` (key retrievable).
- Tests: 325 passing.

---

# a-workbench v0.6.0

_2026-06-08_

Headline: **remote browser tools (computer-use)** — the warm per-user Chromium is now drivable from the MCP client. The model navigates, sees, reads, and clicks; a human can watch and take over the same browser live. Built on the v0.5.0 persistent profile, so prior logins carry over.

## Features
- **`browser_*` computer-use meta-tools.** `browser_navigate(url)`, `browser_screenshot()`, `browser_read_text()`, `browser_click(x,y)`, `browser_type(text)`, `browser_key(keys)`, `browser_scroll(direction)`, `browser_live_url()`, `browser_close()`. The MCP client's own LLM drives step-by-step — no server-side agent loop, no extra API key. Runs against each user's persistent profile (logins from cookie connects carry over).
- **Warm session.** One headless Chromium per user, kept hot across tool calls over a persistent CDP client; idle-reaped after `BROWSER_SESSION_TTL_SECONDS` (default 300). New env: `BROWSER_SESSION_TTL_SECONDS`.
- **Human live-view + take-over.** `browser_live_url()` mints a short-lived link to a `/browser` portal canvas (CDP screencast) where a person watches *and* drives the same session — zero model tokens. Reuses the cookie-capture CDP-WS-proxy + connect-JWT pattern.
- **Screenshots as real MCP image content.** `browser_screenshot` returns an `image` content block the model can view, not base64 text.
- **Token economy.** Screenshots default to downscaled JPEG (`maxWidth` 1000 — resolution is the token lever) and are **change-detected**: an identical re-shot returns `{ unchanged: true }` instead of re-billing the pixels. `browser_read_text` returns plain page text as a far cheaper alternative for reading/forms.

## Architecture / internals
- Extracted a shared Chromium launcher (`profile-chromium.ts`) from `cookie.ts` so cookie-capture and the warm browser session share **one** single-writer lock — they're mutually exclusive per user (`BROWSER_SESSION_BUSY`).
- New WS proxy `/api/browser-session/cdp` + exchange `GET /api/connect/browser-session`, origin-allowlisted and auth-framed; a connect-JWT is bound to `(userId, cdpToken)` and `integration="__browser__"` so it can't attach to another user's session.

## Hardening
- Persistent CDP socket teardown (no unhandled-`error` crash; pending CDP calls reject on close), navigation errors propagate (dead session relaunches), printable-key typing fixed.

## Notes
- Security review: 0 high-confidence findings (cross-user attach, `Runtime.evaluate` injection, path traversal, token exchange all verified safe).
- Specs/plans: `docs/superpowers/specs/2026-06-08-remote-browser-tools-design.md`, `2026-06-08-screenshot-token-economy-design.md` (+ matching plans).
- Tests: 315 passing.

---

# a-workbench v0.5.0

_2026-06-08_

Headline: **persistent per-user browser session** — the cookie-auth capture browser now reuses each user's profile across plugin connects, so prior logins (any site/IdP) carry over instead of starting from a blank browser every time.

## Features
- **Persistent per-user capture profile.** `startCookieSession` launches Chromium against a persistent `<BROWSER_PROFILES_DIR>/<userId>/` profile (`0700`, default next to the SQLite DB) instead of a throwaway dir, and keeps it on close. Connect plugin A (log into a shared IdP), later connect plugin B that uses the same IdP → B's login is already satisfied, no re-prompt. Capture, `ctx.http` replay, and the per-integration cookie store are unchanged.
- **Reset browser session.** `POST /api/browser-session/reset` + an account-level portal control wipe a user's profile (logout-everywhere / repair).
- New env: `BROWSER_PROFILES_DIR`.

## Fixes / hardening
- One active capture session per user (`BROWSER_SESSION_BUSY`) — two Chromium processes can't share a profile dir. Guard auto-releases on close, on a partial-start failure, **and** if the browser process dies out-of-band (no permanent lock).
- Profile dir mode `0700` enforced even when it already exists; `userId` sanitized into the path (no traversal).

## Notes
- This persists/reuses the user's own session — it does **not** bypass a provider's IP/bot defenses. The first login still has to happen from an accepted IP; pairs with `CAPTURE_PROXY` and cookie session import for in-cluster.
- Spec + plan: `docs/superpowers/specs/2026-06-08-per-user-browser-profile-design.md`, `docs/superpowers/plans/2026-06-08-per-user-browser-profile.md`.
- Tests: 282 passing.

---

# a-workbench v0.4.2

_2026-06-02_

Feature: **cookie session export/import** — move a captured cookie-auth session between workbenches.

## Why
Some login providers reject interactive sign-in from datacenter/cloud IPs (Google SSO 500s or stalls them), so a headless in-cluster workbench can't complete the login — even through residential proxies, which Google also flags. Capture instead on a machine the provider trusts (your own browser / a residential IP), then move the live session to the in-cluster instance.

## Features
- `GET /api/integrations/:name/session/export` (authed) → returns the stored cookie bundle.
- `POST /api/integrations/:name/session/import` (authed) → stores a bundle under the caller and marks the integration connected (cookie integrations only; rejects empty/invalid bundles).
- **Portal:** a *Session transfer* section on cookie integrations' detail view — **Export** downloads the bundle, **Import** takes pasted JSON and connects. Available automatically for any `auth.type: "cookie"` plugin.

## Notes
- Sessions are short-lived (the upstream's own TTL), so re-export/import when they expire.
- The export bundle contains live session cookies — handle it as a secret.
- Tests: 271 passing.

---

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
