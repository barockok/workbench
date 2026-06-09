# a-workbench v0.10.1

_2026-06-10_

Headline: **Fix cookie capture 400** — capturing a cookie-auth session from the portal no longer fails with `FST_ERR_CTP_EMPTY_JSON_BODY`.

## Fixes
- **Cookie capture/cancel returned 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.** A v0.10.0 regression: the browser-session unification dropped the now-dead `{ sessionId }` body from the `/api/auth/cookie/:integration/capture` and `.../cancel` POSTs but left them declaring `Content-Type: application/json`, which Fastify rejects when the body is empty. Both requests now use the bodyless `authHeaders()` helper (Authorization only, no content-type) — the same one `disconnectIntegration` uses. See `docs/findings/2026-06-10-empty-json-body-bodyless-post.md`.
