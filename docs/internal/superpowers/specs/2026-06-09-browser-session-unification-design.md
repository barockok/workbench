# Browser Session Unification — Design Spec

_2026-06-09_

## Problem

A user opens the browser-use live view, logs into a site by hand, then tries to
connect that site's cookie-auth integration. Connect fails with HTTP 500:

```
BROWSER_SESSION_BUSY: a browser session is already active for this user
```

Two subsystems each spawn their **own** Chromium on the user's single profile
dir:

- `auth/cookie.ts` → `startCookieSession` → `spawnProfileChromium`
- `auth/browser-session.ts` → `ensureSession` → `spawnProfileChromium`

Chromium permits only one process per `--user-data-dir`, so `activeProfiles` is
a per-user mutex. Whichever subsystem launches first holds it; the second is
refused. The warm browser-use session blocks cookie capture even though the
cookies the user just earned by logging in are sitting right there in the live
session.

## Goal

One Chromium per user, owned by a single session manager. Browser-use driving
and cookie capture both operate on that one session. When the user has already
logged in via the live view, connecting the integration captures the live
cookies with no second browser and no extra login step.

## Architecture

`auth/browser-session.ts` becomes the **sole session owner**. `auth/cookie.ts`
keeps only cookie persistence, the pure capture-filter, and proxy-auth helpers —
no process, no session map.

Dependency direction: `browser-session.ts` → `cookie.ts` (for `CookieData`,
`filterCookies`, proxy-auth helpers). `cookie.ts` no longer imports
`browser-session.ts`. No cycle.

### `auth/cookie.ts` after

Keeps:
- Storage: `storeCookies`, `getCookies`, `deleteCookies`, `isCookieExpired`,
  `hasValidCookies`
- Type: `CookieData`
- Proxy-auth: `createProxyAuthHandler`, `startProxyAuth`
- **New pure fn** `filterCookies(raw, domains, now?)` — domain-scoping +
  expired-drop logic extracted verbatim from today's `captureCookies` body, made
  process-free and unit-testable. `domains` is the already-assembled list
  (`[targetDomain, ...cookieDomains]`). Returns the filtered, normalized
  `CookieData["cookies"]` array.

Deleted: `startCookieSession`, `captureCookies`, `closeCookieSession`,
`getSessionOwner`, `getSessionCdpEndpoint`, the `sessions` Map, the `Session`
interface.

### `auth/browser-session.ts` after

- `WarmSession` renamed `BrowserSession` (it's now the only session type).
- `ensureSession(userId)` unchanged in shape, with one addition: when
  `CAPTURE_PROXY` + `CAPTURE_PROXY_USERNAME` + `CAPTURE_PROXY_PASSWORD` are set,
  wire `startProxyAuth(session.cdpBrowserWsUrl, user, pass)` and store the socket
  on the session so it's closed on teardown. **This also fixes a latent bug:**
  today only the old cookie path answers proxy-auth challenges, so browser-use
  through an authenticated proxy can't authenticate. Now both do.
- **New** `captureLiveCookies(userId, targetDomain, cookieDomains): Promise<CookieData>`
  — gets the user's live `BrowserSession` (throws if none), runs
  `Storage.getCookies` on its `cdpBrowserWsUrl`, applies `filterCookies`, returns
  a `CookieData`. Does **not** store, does **not** kill the session.
- The smart-capture branch needs no separate predicate: it calls
  `captureLiveCookies` once and inspects the returned `CookieData` (non-empty ⇒
  logged in). One CDP round-trip, not two.

### Lifecycle

Capture never kills the session — it's a read. The session's only lifecycle
owners are the existing idle reaper (`reapIdleSessions` + `BROWSER_SESSION_TTL_SECONDS`),
explicit profile reset (`/api/browser-session/reset` → `resetBrowserProfile`),
and process death (`proc.on("exit")` clears `activeProfiles`). Disconnecting an
integration deletes its stored cookies only; it does not touch the shared
browser.

## Data flow

### Smart capture (decision lives in the route / agent connect)

```
session = ensureSession(userId)             // reuse live, else spawn — one chromium
data = await captureLiveCookies(userId, targetDomain, cookieDomains)
if data.cookies has ≥1 unexpired cookie for targetDomain:
    storeCookies(userId, integration, data)
    markConnected(userId, integration)
    → CONNECTED (no live view, no /connect link)
else:
    navigate(session, loginUrl)
    → LOGIN_REQUIRED (return live-view link / cdpToken)
```

`isCookieExpired(data)` already encodes "≥1 unexpired cookie" — reuse it for the
branch test (`!isCookieExpired(data)`).

The cold path's capture is triggered by an **explicit button** (existing portal
capture endpoint), not auto-detected.

### Identity: sessionId collapses to userId

The warm session is keyed by `userId` and identified by its `cdpToken`. All
connect JWTs already carry a `sessionId` field; for cookie links we set
`sessionId = userId` (browser links already do). The CDP proxy validates
`authedUserId === msg.sessionId` then `getWarmCdpEndpoint(userId, cdpToken)` —
identical to today's browser-session proxy. The per-capture `sessionId` and the
pending record's `cookieSessionId` are no longer needed.

## Touchpoints (every cookie-session caller migrates)

1. **`api/routes.ts` `GET /api/auth/:integration` (cookie branch)** — replace
   `startCookieSession(...)` with the smart-capture flow above. Returns either
   `{ type:"cookie", status:"connected" }` or
   `{ type:"cookie", status:"login_required", cdpToken, cdpProxyUrl, loginUrl }`.
   `cdpProxyUrl` stays `/api/auth/cookie/:integration/cdp` for portal compat.

2. **`api/routes.ts` `POST /api/auth/cookie/:integration/capture`** — drop the
   `getSessionOwner`/`sessionId` checks. Authenticate, then
   `captureLiveCookies(user.userId, targetDomain, cookieDomains)`; if non-empty
   store + `markConnected` → `{ success:true, cookieCount }`; if empty →
   400 `{ error:"No cookies captured. Complete login before capturing." }`.
   Never closes the session.

3. **`api/routes.ts` `POST /api/auth/cookie/:integration/cancel`** — becomes a
   soft dismiss: returns `{ success:true }` without tearing down the shared
   session (idle reaper reclaims it). Kept for portal compat.

4. **`api/routes.ts` `GET /api/connect/session` + `POST /api/connect/capture`**
   (magic-link page) — `session` returns `sessionId = payload.userId`; `capture`
   drops `getSessionOwner`, calls `captureLiveCookies(payload.userId, ...)`,
   stores + `markConnected`, no teardown.

5. **`mcp/meta-tools.ts` `startConnect` (cookie branch)** — `ensureSession`,
   then smart capture. If live cookies exist: `createPending` then immediately
   `markConnected(rec.connectionId)` so `wait_for_connection` resolves at once;
   return `{ connectionId, type:"cookie", connected:true }` (no URL needed). Else
   `createPending` (no `cookieSessionId`), sign a connect JWT with
   `sessionId = userId`, return the `/connect/<integration>?t=` URL. Remove the
   `closeCookieSession` error-path call and import.

6. **`index.ts` cookie CDP proxy `/api/auth/cookie/:integration/cdp`** — replace
   the `require("./auth/cookie").getSessionOwner` + `getSessionCdpEndpoint` block
   with the same validation the browser proxy uses: require
   `authedUserId === msg.sessionId`, then `getWarmCdpEndpoint(authedUserId, msg.cdpToken)`.
   Origin checks and frame normalization unchanged.

7. **`auth/connections.ts` `reapExpired` / `reapOne`** — remove the
   `closeCookieSession(rec.cookieSessionId)` calls; pending expiry only flips
   status to EXPIRED. `cookieSessionId` field on the pending record is removed
   (or left unused — implementer's call, prefer removal). Nothing to kill.

8. **Session export/import** (`/session/export`, `/session/import`) — unchanged;
   they use the storage helpers, which stay.

## Error handling

- `ensureSession` still throws `BROWSER_SESSION_BUSY` only on a genuine spawn
  race within a single process; callers surface it as today (503/409). With one
  session per user this should effectively never fire from the unified paths,
  since both reuse the same session.
- `captureLiveCookies` throws `"No browser session"` if none exists; callers that
  call it after `ensureSession` won't hit this. The capture endpoints guard by
  returning 400 on empty cookie sets rather than on a missing session.
- Empty capture (logged-in check false, or button pressed too early) → 400 with
  the "complete login" message; the session stays alive so the user can retry.

## Testing

- **`filterCookies`** (pure): domain scoping (exact + subdomain match, sibling
  host excluded), expired-cookie drop, session-cookie (no `expires`) kept. Ported
  from existing capture tests, now process-free.
- **`captureLiveCookies`**: stub the CDP `Storage.getCookies` result; assert
  filtering produces the expected `CookieData`. No real Chromium.
- **Smart-capture route**: with stubbed live cookies present → 200 `connected`,
  cookies stored, `markConnected` called, no live-view fields. With none → 
  `login_required` + `navigate(loginUrl)` invoked.
- **Capture endpoint**: non-empty → stored + connected; empty → 400, session not
  killed.
- **Proxy-auth wiring**: `ensureSession` opens a proxy-auth socket when
  `CAPTURE_PROXY` + creds set, none otherwise.
- **Regression**: connecting a cookie integration while a browser-use session is
  live no longer throws `BROWSER_SESSION_BUSY`.
- **`connections.ts` reaper**: pending expiry flips to EXPIRED without attempting
  any session teardown.

## Out of scope

- Auto-detecting login completion (explicit button only).
- Any change to OAuth or API-key integrations.
- Multi-replica concurrent profile access (tracked separately; see the
  2026-06-09 singleton-lock finding).
