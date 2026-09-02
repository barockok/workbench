# Connect-link handshake

_2026-09-02_

## Problem

An agent connected to workbench account A asks the human to reconnect an
integration. The agent mints a link, the human opens it, completes the login,
and the credential is stored under account A.

Nothing in that flow proves the human who opened the link is the owner of
account A. The link is a bearer capability: `userId` is captured when the link
is minted, and every redemption path trusts the link alone.

Two consequences.

The human completes the flow while logged in to the provider as themselves. The
resulting credential — their personal GitHub, their personal Jira — is stored
under account A. The agent on account A can then act as that human. Neither
side is told this happened.

A link that leaves the intended human's hands works for whoever holds it. A
forwarded link lets a third party attach a credential into account A, and on the
cookie and browser-session paths it also hands them a live CDP handle to account
A's server-side browser for the life of the token.

### Where it lives in the code

**OAuth path.** `startConnect` (`packages/server/src/mcp/meta-tools.ts:62`) calls
`buildPluginAuthUrl`, which calls `createAuthState(userId, integration, …)`
(`packages/server/src/auth/plugin-oauth.ts:214`) and writes
`pending_auth.user_id = A`. The callback
`/api/auth/plugin/:integration/callback` (`packages/server/src/api/routes.ts:410`)
calls no `authenticate(request)`. The `state` value is the only authority.

**Cookie path.** `startConnect` (`meta-tools.ts:42-51`) warms account A's browser
session, mints a connect JWT carrying `userId` **and** the live `cdpToken`, and
returns `PORTAL_URL/connect/<integration>?t=<jwt>`. `/api/connect/session` and
`/api/connect/capture` (`routes.ts:577`, `routes.ts:594`) verify only that JWT.
The comment above them states the design intent: "used by the /connect
magic-link page — no portal session".

**Browser-session path.** `browser_live_url`
(`packages/server/src/plugins/internal/browser.ts:134`) mints the same kind of
JWT for `__browser__` and returns `PORTAL_URL/browser?t=<jwt>`.
`/api/connect/browser-session` (`routes.ts:621`) verifies only the JWT.

**Portal.** `/connect/:integration` and `/browser` sit outside `RequireAuth`
(`packages/portal/src/App.tsx:28-29`), which is what makes the magic-link
behaviour possible.

## Scope

In scope: prove that the human redeeming a link owns the workbench account the
link was minted for, and refuse to proceed otherwise. All three paths above.

Out of scope: recording which *provider* identity was connected. The handshake
proves the human owns account A. It does not prove they picked the right
provider account — someone with a personal and a work GitHub in the same browser
can still consent as the wrong one, and no column holds the answer today. That
is a separate problem and a separate change.

## Design

The link stops being a capability and becomes a claim. It names an integration
and the workbench user it was minted for. Redeeming it requires a proven portal
session, and the server proceeds only when the two identities match.

Every side effect moves to after the match. Today the agent's `connect` call
warms a browser session, mints a CDP token, and (on the OAuth path) writes a
`pending_auth` row — all before any human has been identified. After this
change, `connect` allocates a pending record and returns a link, and nothing
else happens until the handshake passes.

### Flow

1. Agent calls `connect(integration)` on account A. Server creates the pending
   record and returns `{ connectionId, url }` where `url` is
   `PORTAL_URL/connect/<integration>?t=<jwt>`, for every auth type.
2. Human opens the link. The portal route now sits inside `RequireAuth`, so an
   unauthenticated human goes through the existing SSO flow and returns.
3. The page calls `POST /api/connect/redeem` with the portal session bearer and
   the link token.
4. The server verifies the link token, loads the pending record, and compares
   `session.userId` against the link's `userId`.
5. On a match the server does the work the auth type needs and marks the pending
   record redeemed. On a mismatch it returns 403 and does nothing.

### `POST /api/connect/redeem`

Request carries `Authorization: Bearer <portal session JWT>` and the link token
in the body.

Checks, in order:

| Failure | Status | Body |
|---|---|---|
| No session | 401 | `{ error: "AUTH_REQUIRED" }` |
| Link token invalid or expired | 401 | `{ error: "LINK_INVALID" }` |
| Pending record missing, expired, or already redeemed | 410 | `{ error: "LINK_CONSUMED" }` |
| `session.userId !== link.userId` | 403 | `{ error: "ACCOUNT_MISMATCH", integration }` |

On success, by auth type:

- **cookie** — `ensureSession(userId)`, navigate to `integ.auth.loginUrl`, and
  return `{ type: "cookie", integration, loginUrl, cdpProxyUrl, sessionId, cdpToken }`.
- **oauth2** — `createAuthState` + `buildPluginAuthUrl`, return
  `{ type: "oauth2", url }` for the page to redirect to.
- **`__browser__`** — `ensureSession(userId)` and return
  `{ type: "browser", cdpProxyUrl, sessionId, cdpToken }`.

The `cdpToken` is still needed — `getWarmCdpEndpoint`
(`packages/server/src/auth/browser-session.ts:180`) gates attachment on it — but
it is now handed to a caller who has already proved they own the account,
instead of riding in a URL anyone could hold.

The mismatch response deliberately names the integration. The human already
knows which integration the agent asked about, so naming it leaks nothing they
did not have, and an unnamed error is not actionable.

### Link token

`ConnectTokenPayload` (`packages/server/src/auth/connect-token.ts:8`) loses
`cdpToken`. The remaining fields — `connectionId`, `userId`, `integration`,
`sessionId` — are a claim, not a capability. A leaked link is then worth nothing
to anyone who cannot also authenticate as account A.

### CDP authorization

`authorizeCdpFrame` (`packages/server/src/auth/cdp-authz.ts:22`) already prefers
`portalUserId` when the caller has a portal session, and falls back to a connect
JWT when it does not. After this change the page always has a session, so the
connect-JWT branch is removed. `CdpScreencast` sends the portal session token
instead of the link token, and keeps sending the `cdpToken` from the redeem
response as a second factor pinning the socket to one warm session.

This is what actually closes the live-browser exposure. Gating the redeem
endpoint alone would still leave a token that authenticates a CDP websocket.

### Single use

`PendingConnection` (`packages/server/src/auth/connections.ts:6`) gains a
`redeemedAt?: number`. `redeem` sets it and refuses a record that already has
it. This costs one field and stops a link working twice — after a successful
handshake the link is spent, so a later leak of the same URL is inert.

`status` is not reused for this. `markConnected` resolves by
`(userId, integration)` and flips `PENDING` to `CONNECTED`; a redeemed-but-not-
yet-completed record must stay `PENDING` for `wait_for_connection` to behave.

### Portal

`/connect/:integration` and `/browser` move inside `RequireAuth`
(`packages/portal/src/App.tsx`). `Connect.tsx` calls `redeem` first and
switches on the result: cookie renders the existing screencast and capture UI,
oauth2 redirects to the provider URL, and each error code above renders its own
message. `ACCOUNT_MISMATCH` states plainly that the link belongs to a different
workbench account, names the integration, and offers sign-out so the human can
return as the right account. It offers no way to proceed.

### Existing endpoints

`/api/connect/session` and `/api/connect/browser-session` are both replaced by
`redeem` and removed. Each returned live-view details and a `cdpToken` on the
strength of the link token alone, which is the defect itself; `redeem` answers
the same questions behind the session check.

`/api/connect/capture` stays, because capture is a separate act from redemption
and happens after the human has finished logging in. It gains the same
session-plus-match check, so the gate holds against a direct API call and does
not depend on the page behaving.

### Agent-facing contract

`connect` and its deprecated alias `get_auth_url` stop returning a provider
consent URL for oauth2 integrations. The returned `url` is always a workbench
link. The tool description says so, because an agent that expects a provider URL
and gets a workbench one will otherwise describe the wrong thing to the human.
`wait_for_connection` is unchanged.

`docs/site/_content/reference/meta-tools.md` documents the current oauth2
response as "`url` is the provider consent page" and must be corrected, along
with any provider page describing the OAuth callback flow.

## Testing

Server tests, per path:

- Redeem with a matching session succeeds and marks the record redeemed.
- Redeem with a session for a different user returns 403 `ACCOUNT_MISMATCH`, and
  no `pending_auth` row is written, no browser session is warmed, no token
  stored.
- Redeem with no session returns 401.
- Redeem twice returns 410 on the second call.
- Redeem with an expired link token returns 401.
- `/api/connect/capture` with a valid link token but a mismatched session
  returns 403, so the gate does not depend on `redeem` having run.
- `/api/connect/session` and `/api/connect/browser-session` are gone (404).
- `authorizeCdpFrame` rejects a frame whose only credential is a connect JWT.
- OAuth: `buildPluginAuthUrl` is not reached before a successful handshake.

Portal: `ACCOUNT_MISMATCH` renders the mismatch view with no path to continue.

## Notes

Two pre-existing issues are visible from here and are not addressed:

`markConnected` (`connections.ts:47`) resolves by `(userId, integration)` rather
than `connectionId`. It stays correct under this design, since the handshake
guarantees both records belong to the same user.

The pending store is an in-memory `Map` (`connections.ts:16`), so in cluster
mode a link minted on one node is not redeemable on another. This predates the
change; the handshake makes it easier to hit.
