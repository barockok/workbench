# Cookie capture/replay across subdomains — scope cookies to the target host

**Date:** 2026-05-31
**Area:** `packages/server/src/auth/cookie.ts` (`captureCookies`, `isCookieExpired`), `packages/server/src/plugins/context.ts` (`ctx.http` cookie path)

A cookie-auth integration whose login spans multiple subdomains (ng-mis: app at `ngmis.acme.id`, SSO at `sso.acme.id`, both under `.acme.id`) connected successfully but every tool call failed. Three separate bugs, all in how captured cookies are stored and replayed.

## 1. "Any cookie expired → connection dead" was too aggressive

`captureCookies` sweeps **all** cookies under the declared `cookieDomains` (here `.acme.id`), which pulls in unrelated short-lived cookies — a Keycloak `KC_AUTH_SESSION_HASH` that lapses ~10s after login, CleverTap analytics (`WZRK_*`). The old check:

```ts
isCookieExpired = cookies.some(c => c.expires && c.expires < now)
```

marked the whole integration `NOT_CONNECTED` the moment any of that junk expired, even though the real `__Secure-next-auth.session-token` was valid for a day. Fixes: drop already-expired cookies **at capture time**, and treat the connection dead only when **no live cookie remains**.

## 2. Replaying ALL cookies to every host (the real blocker)

`ctx.http` sent every captured cookie on every request regardless of the cookie's domain. Sending the `sso.acme.id` Keycloak cookies to `ngmis.acme.id`:

- bloated the `Cookie` header to ~8.6 KB → the app's nginx rejected it with **`400 Request Header Or Cookie Too Large`**;
- when it didn't 400, NextAuth saw a cookie set no browser would send and returned `{}` (unauthenticated).

Fix: scope cookies to the target host like a browser — a host-only cookie (`domain === host`) goes only to that host; a domain cookie (`.example.com`) goes to the domain and its subdomains. Dropping the 3 sibling-host cookies cut the header to ~7.7 KB, NextAuth authenticated, and the token came back.

## 3. (plugin-side) gateway environment mismatch

Last mile, not a workbench bug: ng-mis defaulted `NGMIS_API_BASE_URL` to the **staging** KrakenD gateway while the app/token were **PROD** → `401`. Pointing it at the prod gateway returned data. Worth noting because the symptom (`SESSION_DEAD`) was identical to an auth failure — the ng-mis lib throws the same message for a `/api/auth/session` miss and a downstream `401`.

## Takeaway

When capturing cookies for a login that federates across subdomains, you inevitably grab cookies for sibling hosts and short-lived SSO/analytics junk. Two rules keep it working: (a) **liveness = at least one live cookie**, not "none expired"; (b) **replay = browser-scoped cookies**, not the whole jar — sending everything everywhere breaks both header-size limits and host-specific auth. Verify cookie auth **in the container, end-to-end**, because the failure only appears against a real multi-subdomain login.
