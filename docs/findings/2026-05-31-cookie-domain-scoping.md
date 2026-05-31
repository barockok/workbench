# Cookie capture/replay across subdomains — scope cookies to the target host

**Date:** 2026-05-31
**Area:** `packages/server/src/auth/cookie.ts` (`captureCookies`, `isCookieExpired`), `packages/server/src/plugins/context.ts` (`ctx.http` cookie path)

A cookie-auth integration whose login spans multiple subdomains (app at `app.example.com`, SSO at `sso.example.com`, both under `.example.com`) connected successfully but every tool call failed. Two bugs in how captured cookies are stored and replayed (plus one plugin-side env gotcha).

## 1. "Any cookie expired → connection dead" was too aggressive

`captureCookies` sweeps **all** cookies under the declared `cookieDomains` (here `.example.com`), which pulls in unrelated short-lived cookies — an SSO session-hash cookie that lapses ~10s after login, third-party analytics cookies. The old check:

```ts
isCookieExpired = cookies.some(c => c.expires && c.expires < now)
```

marked the whole integration `NOT_CONNECTED` the moment any of that junk expired, even though the real session-token cookie was valid for a day. Fixes: drop already-expired cookies **at capture time**, and treat the connection dead only when **no live cookie remains**.

## 2. Replaying ALL cookies to every host (the real blocker)

`ctx.http` sent every captured cookie on every request regardless of the cookie's domain. Sending the `sso.example.com` cookies to `app.example.com`:

- bloated the `Cookie` header (~8.6 KB) → the app's reverse proxy rejected it with **`400 Request Header Or Cookie Too Large`**;
- when it didn't 400, the app saw a cookie set no browser would send and returned an empty/unauthenticated response.

Fix: scope cookies to the target host like a browser — a host-only cookie (`domain === host`) goes only to that host; a domain cookie (`.example.com`) goes to the domain and its subdomains. Dropping the sibling-host cookies cut the header to ~7.7 KB and the app authenticated.

## 3. (plugin-side) gateway environment mismatch

Last mile, not a workbench bug: a plugin defaulted its API base URL to a **non-production** gateway while the captured session/token were for **production** → `401`. Pointing the base URL at the matching environment returned data. Worth noting because the symptom can be identical to an auth failure — a plugin may surface the same "session expired" message for both a session-endpoint miss and a downstream `401`.

## Takeaway

When capturing cookies for a login that federates across subdomains, you inevitably grab cookies for sibling hosts and short-lived SSO/analytics junk. Two rules keep it working: (a) **liveness = at least one live cookie**, not "none expired"; (b) **replay = browser-scoped cookies**, not the whole jar — sending everything everywhere breaks both header-size limits and host-specific auth. Verify cookie auth **in the container, end-to-end**, because the failure only appears against a real multi-subdomain login.
