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
