# Slack OAuth: user tokens need `user_scope`, nest under `authed_user`, and errors hide in 200s

**Date:** 2026-06-11

## Finding

Wiring the Slack plugin to act *as the authorizing user* (not as a bot) tripped three Slack-specific deviations from vanilla OAuth 2.0:

1. **Scope param split.** Slack reads the standard `scope` query param as *bot* scopes and issues an `xoxb-` bot token. User scopes must go in a separate `user_scope` param to get an `xoxp-` user token. Generic OAuth code that always sets `scope` silently builds a bot integration.

2. **Token nesting.** `oauth.v2.access` returns the bot token at the top-level `access_token`; the user token is nested at `authed_user.access_token` (with its own `refresh_token`/`expires_in` when token rotation is on). Generic exchange code that reads top-level `access_token` stores the wrong token — or `undefined` when no bot scopes were requested.

3. **HTTP 200 error envelope.** Slack returns errors as `200 {ok:false, error}` — a `response.ok` check passes and the failure surfaces later as a stored garbage token.

Also: `files.upload` returns `method_deprecated` for Slack apps created after May 2025. Upload requires the 3-step external flow (`files.getUploadURLExternal` → POST bytes to pre-signed URL → `files.completeUploadExternal`). And `search.all` is user-token-only — it can never work on a bot token.

## Resolution

- `buildPluginAuthUrl` sends scopes as `user_scope` for slack (`packages/server/src/auth/plugin-oauth.ts`)
- `handlePluginCallback` extracts `authed_user.*` and rejects `ok:false` bodies for slack
- Slack app config must declare the same scopes under `scopes.user` (not `scopes.bot`)
- `slack_upload_file` migrated to the external upload flow (`packages/plugins/slack/tools/index.ts`)
