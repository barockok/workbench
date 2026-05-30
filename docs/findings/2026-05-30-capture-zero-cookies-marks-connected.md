# Finding: cookie capture with zero cookies marked the session CONNECTED

**Date:** 2026-05-30
**Status:** Resolved (guard added to both capture handlers).
**Area:** `packages/server/src/api/routes.ts`

## What

Both cookie-capture endpoints called `markConnected` (and ran `storeCookies` +
`closeCookieSession`) even when `captureCookies` returned an empty cookie array.
This happened when the browser extension or portal triggered capture before the
user finished logging in.

Affected endpoints:

- `POST /api/auth/cookie/:integration/capture` (dashboard flow, portal-session-authed)
- `POST /api/connect/capture` (magic-link flow, connect-JWT-authed)

Both previously did, unconditionally:

```
captureCookies(sessionId)
  → storeCookies(...)
  → closeCookieSession(...)
  → markConnected(...)
  → { success: true, cookieCount: 0 }
```

## Why it matters

`markConnected` writes a `CONNECTED` record for the user+integration pair. Any
subsequent call to `wait_for_connection` would return `CONNECTED` immediately —
even though no cookies were stored. The integration appeared connected but every
tool call would fail: `hasValidCookies` returns false, `createContext` throws
`NOT_CONNECTED`, and `execute_tool` returns an error.

The user had no obvious signal that capture "succeeded" but the connection was
hollow. They would need to restart the whole connect flow to recover.

Additionally, `closeCookieSession` was called on the zero-cookie path, killing
the headless chromium session — preventing the user from retrying capture in the
same session after completing login.

## Resolution

Both handlers now guard immediately after `captureCookies`:

```ts
if (cookies.cookies.length === 0) {
  return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
}
```

On zero cookies: the session is kept alive (no `closeCookieSession`), nothing is
stored, and `markConnected` is not called. The client receives a 400 and can
prompt the user to finish logging in and retry capture.

The ≥1-cookie success path is unchanged.

See related specs/plans at:
- `docs/superpowers/specs/2026-05-30-mcp-initiated-connect-design.md`
- `docs/superpowers/plans/2026-05-30-mcp-initiated-connect-plan.md`
