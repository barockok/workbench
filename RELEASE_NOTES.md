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
