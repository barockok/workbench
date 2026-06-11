# a-workbench v0.11.0

_2026-06-12_

Headline: **PKCE + public-client support for plugin OAuth**, and the **Slack plugin acts as the authorizing user** instead of a bot.

## Features
- **PKCE on every plugin OAuth flow (RFC 7636).** Authorize redirects now carry an S256 `code_challenge`; the verifier is stored server-side in `pending_auth` alongside the state (new `code_verifier` column, auto-migrated) and sent as `code_verifier` on the token exchange. Confidential clients keep PKCE too — OAuth 2.1 baseline; providers without PKCE support ignore the extra params per RFC 6749.
- **Public (PKCE-only) OAuth clients.** A plugin is now configured with `<PLUGIN>_CLIENT_ID` alone — a missing or empty `<PLUGIN>_CLIENT_SECRET` means a public client (e.g. a Keycloak client with client authentication off). Token exchange and refresh omit `client_secret` entirely rather than sending an empty string, which Keycloak rejects. Previously such plugins showed "not configured" in the portal and could never connect.
- **Slack plugin acts as the user.** Slack reads the standard `scope` param as *bot* scopes and nests the user token under `authed_user.access_token`; the plugin now sends scopes as `user_scope` and stores the user token, so tools act as the authorizing user and `search.all` (user-token-only) works. Scopes expanded to cover all tools (`conversations.history`/`.replies`, `reactions:write`, `users:read`, `search:read`) — declare them under `scopes.user` on the Slack app. `slack_upload_file` migrated off the dead `files.upload` API to the 3-step external upload flow; `slack_find_users` email lookup fixed (`users.lookupByEmail` takes `email`, not `query`).

## Notes
- Tests: 438 passing, CI clean on both PRs (#30, #31).
