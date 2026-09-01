---
title: GitHub
description: Connect GitHub so an agent can work with repositories, issues, pull requests, code review, and Actions.
---

The GitHub integration is the largest code-hosting surface in the catalog. It covers repository and file reads, the whole issue lifecycle, and the whole pull-request review loop, including formal review verdicts. It also covers code and issue search, and GitHub Actions run control.

## At a glance

| | |
|---|---|
| Plugin id | `github` |
| Auth | OAuth 2.0 (OAuth App, user-to-server) |
| Tools | 28 |
| Authorization URL | `https://github.com/login/oauth/authorize` |
| Token URL | `https://github.com/login/oauth/access_token` |
| Proxy base | `https://api.github.com` |

This is an OAuth App, not a GitHub App. It has one callback URL and classic scope strings. Whether its user tokens expire is a property of the app on GitHub's side, not of this server. See [GitHub's OAuth App documentation](https://docs.github.com/en/apps/oauth-apps). The server refreshes a token when the provider gave it an expiry and a refresh token.

## Set up the OAuth app

> [!NOTE] The console steps are GitHub's UI, not this server's
> Menu names, labels, and page URLs below come from GitHub's console and change
> without notice. If what you see differs, follow [GitHub's own documentation](https://docs.github.com/en/apps/oauth-apps) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the app

Personal: [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.

Organization (better for team deployments): `https://github.com/organizations/<ORG>/settings/applications` → **OAuth Apps** → **New OAuth App**.

### Fill in the fields

| Field | Value |
|---|---|
| Application name | your deployment name |
| Homepage URL | `https://<your-workbench-host>` |
| Authorization callback URL | `https://<your-workbench-host>/api/auth/plugin/github/callback` |
| Enable Device Flow | leave off |

An OAuth App accepts exactly one callback URL. For local development register a second app with `http://localhost:3000/api/auth/plugin/github/callback`.

### Generate the secret

Copy the **Client ID** from the app page, then **Generate a new client secret** and copy it — GitHub shows it once.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `repo` | Full control of public and private repositories: contents, commits, issues, pull requests, and Actions |
| `read:user` | Read the authenticated user's profile |
| `read:org` | Read organization and team membership |
| `issues` | Requested by the manifest; see the note below |
| `pull_requests` | Requested by the manifest; see the note below |

> [!WARNING] `issues` and `pull_requests` are not classic OAuth App scopes
> GitHub's classic scope list has no separate `issues` or `pull_requests` entries — `repo` covers both. GitHub ignores the unknown strings, so the flow works, but do not treat them as the thing granting issue or PR access. If you ever migrate this integration to a GitHub App, they become real fine-grained permissions and the mapping changes.

`repo` is broad. It is what the file-write, Actions, and private-repo tools need, and GitHub offers no narrower classic scope that keeps them working.

## Server configuration

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

## Connect

Portal: Connections → **Connect** on the GitHub card.

Agent:

```
connect({ integration: "github" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `github_list_repos` | The authenticated user's repositories as slim rows |
| `github_get_repo` | One repository's metadata with URL bloat stripped |
| `github_list_branches` | Branch names and protection flags |
| `github_list_commits` | Commits newest-first, optionally from a branch or SHA |
| `github_list_releases` | Releases newest-first |
| `github_get_content` | Read a file (base64 + sha) or list a directory at a ref |
| `github_create_or_update_file` | Commit a single file; updating requires its current sha |
| `github_create_issue` | Create an issue with optional body and labels |
| `github_list_issues` | List issues; rows carry `is_pr` because GitHub mixes PRs in |
| `github_get_issue` | One issue, body truncated to 2000 characters |
| `github_update_issue` | Change title, body, state, labels, or assignees |
| `github_add_issue_comment` | Comment on an issue or a PR conversation |
| `github_create_pr` | Open a pull request from head into base |
| `github_list_prs` | List pull requests, default state open |
| `github_get_pr` | One PR with merge state and change counts |
| `github_get_pr_diff` | Full diff, or a cheap per-file summary with `files:true` |
| `github_list_pr_comments` | Conversation comments or inline review comments |
| `github_add_pr_comment` | Post a conversation comment or an inline code comment |
| `github_create_pr_review` | Submit APPROVE, REQUEST_CHANGES, or COMMENT with a summary |
| `github_merge_pr` | Merge the PR into its base branch |
| `github_search_code` | Code search; qualifiers in `q` are forwarded verbatim |
| `github_search_issues` | Issue and PR search across GitHub |
| `github_list_workflow_runs` | Actions runs, newest first, filterable by branch |
| `github_trigger_workflow` | Start a run via `workflow_dispatch` |
| `github_get_workflow_run` | Poll one run's status and conclusion |
| `github_rerun_workflow_run` | Re-run all jobs, or only the failed ones |
| `github_cancel_workflow_run` | Cancel an in-progress run |
| `github_get_clone_url` | Mint `https://x-access-token:<token>@github.com/...` for clone, pull, or push |

## Notes and gotchas

> [!WARNING] The clone URL embeds a live credential
> `github_get_clone_url` returns the user's real access token inside a URL string. It works for push because `repo` covers write. Mint it immediately before use, and keep it out of files, git remotes, and shell history.

`github_trigger_workflow` needs the workflow to declare `on: workflow_dispatch`, and GitHub answers with 204 and no run id. Poll `github_list_workflow_runs` to find the run you just started.

`github_create_or_update_file` requires the file's current sha when updating. Read it with `github_get_content` first. A stale sha is rejected.

GitHub's token endpoint returns `application/x-www-form-urlencoded` by default, which breaks a naive JSON parse of the token response. The server sends `Accept: application/json` on the exchange, so this is already handled. It is worth knowing if you are debugging a connect failure against a fork or a proxy.

A 403 mentioning organization SAML enforcement is not a scope problem — no change to the scope table fixes it. The user has to authorize their token for that organization on GitHub's side. [GitHub's documentation on SAML and authorized tokens](https://docs.github.com/en/apps/oauth-apps) has the current procedure.

GitHub rate-limits OAuth calls per user and applies separate secondary limits to bursts of writes. The current numbers are in [GitHub's REST API documentation](https://docs.github.com/en/rest).
