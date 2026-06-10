# a-workbench v0.10.2

_2026-06-10_

Headline: **Cookie connect always re-verifies login**, plus a **static out-of-band OAuth redirect page** for CLI agents.

## Changes
- **Cookie-auth connect always opens the login live view.** A v0.10.0 regression: after disconnecting a cookie integration and reconnecting, the "smart capture" fast-path instantly marked it connected from cookies still present in the shared browser session — even though disconnect only deletes the *stored* cookies, not the browser session's, so a stale/invalid session could silently reconnect. Connect now always prompts login (the instant fast-path is removed from both the portal route and MCP `startConnect`); the user logs in and clicks Capture. The Capture flow and `captureLiveCookies` are unchanged.
- **Static `GET /oauth/callback` out-of-band redirect landing page.** For CLI agents that can't host a redirect listener: the OAuth provider redirects to this generic, no-auth page, which shows the full redirect URL (verbatim, including `?code&state`) with a Copy button. The user pastes it back to the agent, which does the code exchange itself — workbench does no server work. Hardened: the URL reaches the DOM only via `input.value` (no HTML sink), `CSP: default-src 'none' … frame-ancestors 'none'`, `X-Frame-Options: DENY` (no clickjacking the Copy button into leaking the auth code), `Referrer-Policy: no-referrer`. Pointing plugin `redirect_uri`s at this page and the agent-side tool that consumes the pasted URL are follow-ups.

## Notes
- Tests: 412 passing. The same pre-existing/flaky suite failures as prior releases (`loader.test.ts` ×2; `users.test.ts` shared-SQLite race, passes in isolation) are unrelated — both PRs passed CI clean.
