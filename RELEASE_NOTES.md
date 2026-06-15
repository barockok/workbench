# a-workbench v0.14.0

_2026-06-15_

Headline: **GitLab integration (cloud + self-hosted), Slack file tools, and CI pipeline triggers across GitHub/GitLab/Bitbucket.**

## Features

- **GitLab plugin** — full integration at parity with GitHub/Bitbucket: projects, branches, commits, releases, files, issues, merge requests (create/list/get/diff/comments/inline review/approve/merge/close), pipelines, search, and a token-bearing clone URL.
  - **Self-hosted support** (new platform capability): a connect-time instance-URL prompt (`OAuthConfig.instance`) carried through the OAuth handshake (`connections.config` / `pending_auth.config`), origin-swapped authorize/token/refresh (`resolveOAuthUrls`), and exposed to tools via `ctx.getConfig()` for the right API base.
  - **Security**: the chosen origin receives the shared client secret on the token POST, so it must be the cloud default or admin-allowlisted via `GITLAB_ALLOWED_INSTANCES`. `normalizeInstanceUrl` enforces https-only, rejects userinfo, and blocks private/loopback/link-local literals.
- **Slack file tools** — `slack_download_file` (download attachments via `url_private(_download)`; host-allowlists Slack before sending the Bearer, follows the presigned-CDN redirect without the token, guards the login-HTML no-access case), plus `slack_get_file_info`, `slack_get_permalink`, `slack_remove_reaction`, and `slack_join_channel`. Adds the `files:read` + `channels:write` scopes.
- **CI pipeline triggers** — trigger / poll / rerun / cancel across all three providers:
  - GitHub Actions: `github_trigger_workflow` (workflow_dispatch + `inputs`), `github_get_workflow_run`, `github_rerun_workflow_run` (all | failed-only), `github_cancel_workflow_run`.
  - GitLab Pipelines: `gitlab_trigger_pipeline` (+`variables`), `gitlab_get_pipeline`, `gitlab_retry_pipeline`, `gitlab_cancel_pipeline`.
  - Bitbucket Pipelines: `bitbucket_trigger_pipeline` (branch + optional `custom` selector, `variables`, `secured`), `bitbucket_get_pipeline`, `bitbucket_stop_pipeline`. Adds the `pipeline` + `pipeline:write` scopes.

## Refactors

- **`execute_tool` removed** — the singular meta-tool (and its wire schema + shared `executeToolSchema`) is gone; `execute_tools` covers the single-call case with a one-element `executions` array. The MCP image renderer is now decoupled from the old result wrapper — it scans `.result` / `.results[]` generically and emits one image block per `_mcpImage` sentinel, so screenshots still render through `execute_tools` (including multi-shot batches).

## Upgrade notes

- **Reconnect required** for existing **Slack** connections (`files:read` + `channels:write`) and **Bitbucket** connections (`pipeline` + `pipeline:write`). GitHub / GitLab need no scope change.
- MCP clients calling the singular `execute_tool` must switch to `execute_tools` with a one-element `executions` array.
