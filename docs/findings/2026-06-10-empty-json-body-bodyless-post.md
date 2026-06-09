# Bodyless POST must not declare `Content-Type: application/json`

**Date:** 2026-06-10

## Symptom

Capturing a cookie-auth session from the portal failed with HTTP 400:

```json
{
  "statusCode": 400,
  "code": "FST_ERR_CTP_EMPTY_JSON_BODY",
  "error": "Bad Request",
  "message": "Body cannot be empty when content-type is set to 'application/json'"
}
```

## Cause

The portal's `captureCookies` / `cancelCookieAuth` POST to
`/api/auth/cookie/:integration/capture` and `.../cancel`. In v0.10.0 the
browser-session unification made these routes derive everything from the
authenticated user + route `:integration`, so the old `{ sessionId }` request
body was dropped as dead weight.

But the requests still used `getHeaders()`, which sets
`Content-Type: application/json`. Fastify's JSON body parser rejects a request
that declares `application/json` with an **empty** body
(`FST_ERR_CTP_EMPTY_JSON_BODY`) before the route handler ever runs. So the body
removal turned a working request into a 400.

## Fix

Use the existing `authHeaders()` helper (Authorization only, no `Content-Type`)
for these bodyless POSTs — the same helper `disconnectIntegration` already uses.
`api.ts` documents the rule inline:

```ts
// Auth header WITHOUT Content-Type — for bodyless requests. Fastify rejects a
// POST/DELETE that declares application/json but sends no body
// (FST_ERR_CTP_EMPTY_JSON_BODY).
function authHeaders(): HeadersInit { ... }
```

## Rule

When a fetch sends no body, do not send `Content-Type: application/json`. Pick
`authHeaders()` (bodyless) vs `getHeaders()` (JSON body) by whether the request
actually has a body. Dropping a request body and leaving the JSON content-type
is a silent 400.

Test note: `app.inject({ payload: {} })` serializes a non-empty `{}` body, so a
route test that passes `payload: {}` does NOT reproduce the empty-body 400 — it
must omit the payload (and content-type) to catch this.
