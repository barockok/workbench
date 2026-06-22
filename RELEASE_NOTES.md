# a-workbench v0.17.1

_2026-06-22_

Headline: **Cookie-auth connect now navigates the browser to the integration's login page.**

## Fixes

- **Cookie-auth connect navigates to `loginUrl`** — `startConnect()` created a CDP session but never navigated it, so the connect screencast showed whatever page the browser last visited (typically google.com on a fresh session). Added the missing `navigate(session, integ.auth.loginUrl)` call, consistent with the `/api/auth/:integration` flow. Affects all cookie-auth integrations (superset, kafkahq, etc.). (`packages/server/src/mcp/meta-tools.ts`)

## Tests

- New test asserting `connect` navigates to the integration `loginUrl` for cookie integrations. (`packages/server/tests/mcp-server.test.ts`, `packages/server/tests/meta-tools.test.ts`)
