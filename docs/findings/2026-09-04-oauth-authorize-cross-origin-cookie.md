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
its cookies the normal way, no proxy or CORS involved. Since the portal
doesn't otherwise know the server's real origin in dev (all its other API
calls go through relative paths + Vite's proxy), `/authorize` hands the
choice page that absolute URL explicitly (`resume=` query param, built from
the server's own `SERVER_PUBLIC_URL`) rather than requiring a second,
separately-configured frontend env var that could drift out of sync.

The lesson generalizes: a cookie set by a direct external redirect *into*
the server (an SSO provider callback, an `/authorize` entry point) is not
retrievable by the portal's own fetch client, no matter how the dev proxy
is configured — only another direct browser navigation to that same
origin gets it back.
