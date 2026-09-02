# Connect links let a stranger's login land under the wrong workbench account

## What happened

A connect link minted by `connect`/`get_auth_url` (or `browser_live_url`) named
the workbench user it was minted for, but nothing that redeemed the link ever
checked that the human opening it *was* that user. The link itself was a bearer
capability: `GET /api/connect/session`, `POST /api/connect/capture`, and
`GET /api/connect/browser-session` all trusted the JWT alone — no portal session
was required to call any of them.

Two distinct consequences followed from that:

- **Honest misdirection.** An agent hands a human a connect link to complete
  (over chat, email, a ticket comment — anywhere a link travels). If that human
  is not signed in to workbench as the account the link was minted for — the
  common case for anyone other than the agent's own operator — completing the
  provider login flow and clicking Capture stored *their own* SaaS credential
  under *the agent's* workbench account. No malice required on either side; the
  link simply carried no check that the two parties agreed on whose account this
  was.
- **Forwarded-link handover.** For the cookie-auth and `browser_live_url` cases,
  `GET /api/connect/session` and `GET /api/connect/browser-session` didn't just
  accept a mismatched identity — they handed back a live `cdpToken` and CDP proxy
  address. Anyone holding the link, forwarded or intercepted, got a working
  handle onto a real, logged-in browser session, independent of whether they ever
  completed a login themselves.

## Root cause

The link was minted with the human-identity check nowhere in its path. Mint time
front-loaded side effects — for oauth2, `connect` built the provider consent URL
directly; for cookie integrations, it warmed a browser session and navigated it
to the login page. Everything downstream (`session`, `capture`,
`browser-session`, the CDP WebSocket auth frame) then treated "holds a valid
connect JWT" as equivalent to "is the account this was minted for." Those are not
the same claim: a JWT proves the link is genuine and unexpired, not who is
holding it.

## Fix

The link became a claim, not a capability. `connect` (and `get_auth_url`) now
returns `{ connectionId, type, url }` for both oauth2 and cookie integrations,
where `url` is always a workbench link — `<PORTAL_URL>/connect/<integration>?t=<jwt>`
— carrying no provider URL and no `cdpToken`. Minting no longer contacts the
provider or touches the browser.

Redemption is a single gated endpoint, `POST /api/connect/redeem`, which:

1. Requires an authenticated portal session (`AUTH_REQUIRED` otherwise).
2. Verifies the link JWT (`LINK_INVALID` if it doesn't parse).
3. Compares the JWT's `userId` against the signed-in session's — a mismatch
   returns `403 ACCOUNT_MISMATCH` before anything else runs, so a wrong-account
   attempt doesn't burn the link for its rightful owner.
4. Only past that gate does it redeem the pending record (`410 LINK_CONSUMED` if
   already used) and run the side effect: build the provider consent URL for
   oauth2, or warm the browser session for cookie / `__browser__`.

`POST /api/connect/capture` got the identical session-plus-match gate.
`GET /api/connect/session` and `GET /api/connect/browser-session` were deleted
outright rather than patched, since their only job — returning session details
off a bearer token alone — is exactly the shape of the bug.

The CDP WebSocket auth frame stopped accepting a connect JWT as `bearer`
entirely; only a portal session authorizes that socket now. And on the portal
side, `/connect/:integration` and `/browser` moved behind `RequireAuth`, so a
signed-out visitor is sent to log in — preserving the destination across SSO's
round trip to `/` — before they can even attempt a redeem.

## What to check if you're extending this

Any new mint site for a connect-shaped link must not embed a capability (a
provider URL, a `cdpToken`, session details) in the token itself, and any new
redemption path must re-derive the side effect only after checking the redeeming
session's `userId` against the link's. Treat the link as proof of "this
connection was requested for user X," never as proof of "the bearer is user X."

The pre-existing in-memory pending-connection store limitation (one process,
not shared across replicas) got slightly worse here. Redemption now requires
the pending record to be present on whichever node serves `/api/connect/redeem`
— previously a stateless bearer-token check could be served by any node. And
`browser_live_url` now creates a pending record where it previously created
none, so in cluster mode a `/browser` link now breaks — 410 `LINK_CONSUMED` —
if the redeem request lands on a different node than the one that minted it,
where it previously worked because there was nothing node-local to miss.
