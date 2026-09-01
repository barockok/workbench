# OAuth Redirect Landing Page — Design Spec

_2026-06-10_

## Problem

An agent running in a CLI cannot host a redirect listener (no reachable port),
so it can't be the `redirect_uri` for an OAuth flow. It needs an out-of-band
landing: the provider redirects to a reachable workbench page, the human copies
the resulting URL, and pastes it back to the agent — which then does the code
exchange itself.

## Goal

A single, generic, **static** landing page that the OAuth provider redirects to.
It displays the full redirect URL (verbatim, including `?code&state`) with a Copy
button. Workbench performs **no** server-side work — no code exchange, no token
storage, no `markConnected`. The page is purely a clipboard hand-off.

## Scope

In scope: the static page only.

Out of scope (explicitly): pointing any plugin's `redirect_uri` at this page
(that's `buildPluginAuthUrl` / env config), and the agent-side tool that consumes
the pasted URL to complete the exchange. Those are separate follow-ups.

## Route

`GET /oauth/callback` — new, no collision:
- Plugin/SSO callbacks live under `/api/auth/...`.
- The MCP OAuth 2.1 server uses `/authorize`, `/token`, `/register`,
  `/.well-known/oauth-*`.

No auth (the provider redirects an unauthenticated browser here). No
`:integration` param, no state handling — fully generic. The page's URL is what
an operator registers as a provider `redirect_uri` for the OOB agent flow.

Served as self-contained HTML (inline CSS + JS) returned by a Fastify route,
mirroring the existing `unlockPage` pattern in `packages/server/src/jots/routes.ts`.
It does not depend on the React portal.

## Behavior

On load, client JS:
1. Reads `window.location.href` — the full URL including the query string.
2. Writes it into a `readonly` `<input>` (or `<textarea>`) via `.value`.
3. A **Copy** button copies that value to the clipboard:
   `navigator.clipboard.writeText(...)` with a `document.execCommand("copy")`
   fallback for non-secure contexts, and a brief "Copied" confirmation.
4. Static instruction text: *"Authorization complete. Copy this URL and paste it
   back to your agent."*

No query params (someone visits the bare path) → it still renders and shows
whatever the URL is; harmless.

## Security

The URL carries attacker-influenceable query values (e.g. a crafted
`?error=<script>`). The page MUST place the URL into the DOM only via
`element.value` or `textContent` — **never** `innerHTML` (or any HTML-parsing
sink). The URL value exists only client-side; there is no server-side templating
of it, so there is no reflected-XSS surface on the server response.

Response headers:
- `Content-Type: text/html; charset=utf-8`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`
  (the page needs its own inline style + script; it loads no external resources
  and makes no network calls).

## Testing

- **Route test** (`packages/server/tests/...`): `GET /oauth/callback` → 200,
  `content-type` is `text/html`, body contains the Copy button and the readonly
  field, and the security headers above are present. Assert the script reads
  `location.href` and assigns it via `.value`/`textContent`, and that the body
  contains no `innerHTML` assignment of the location.
- **Optional jsdom unit test**: load the page HTML into jsdom with
  `window.location` set to `…/oauth/callback?error=<script>alert(1)</script>`,
  run the inline script, and assert the field's `.value` equals the raw URL and
  that no `<script>` element was injected into the document (inert text, not
  executed).

## Files

- `packages/server/src/api/routes.ts` (or a small new module it registers) —
  add the `GET /oauth/callback` route returning the inline HTML. If the HTML
  string is sizeable, factor it into a `oauthRedirectPage()` helper next to the
  route, like `unlockPage`.
- `packages/server/tests/<oauth-redirect>.test.ts` — the route test (+ optional
  jsdom test).
