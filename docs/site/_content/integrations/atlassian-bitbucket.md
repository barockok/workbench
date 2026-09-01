---
title: Bitbucket
description: Connect Bitbucket Cloud so an agent can browse repositories, run the full pull-request review loop, and drive Pipelines.
---

The Bitbucket integration covers a complete review cycle. It can list repos, open a pull request, read its diff, comment inline, approve or request changes, then merge or decline. It also triggers, polls, and stops Bitbucket Pipelines. It can mint a short-lived authenticated clone URL.

## At a glance

| | |
|---|---|
| Plugin id | `atlassian-bitbucket` |
| Auth | OAuth 2.0 (workspace consumer) |
| Tools | 20 |
| Authorization URL | `https://bitbucket.org/site/oauth2/authorize` |
| Token URL | `https://bitbucket.org/site/oauth2/access_token` |
| Proxy base | `https://api.bitbucket.org/2.0` |

Bitbucket Cloud OAuth is separate from the Atlassian developer console that Jira and Confluence use. You create a "consumer" inside a Bitbucket workspace's own settings.

## Set up the OAuth app

> [!NOTE] The console steps are Atlassian's UI, not this server's
> Menu names, labels, and page URLs below come from Atlassian's console and change
> without notice. If what you see differs, follow [Atlassian's own documentation](https://developer.atlassian.com/cloud/bitbucket/oauth-2/) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the consumer

Go to `https://bitbucket.org/<workspace>/workspace/settings/api`, or Workspace settings → **Apps and features** → **OAuth consumers** → **Add consumer**.

### Fill in the callback URL

| Field | Value |
|---|---|
| Name | your deployment name |
| Callback URL | `https://<your-workbench-host>/api/auth/plugin/atlassian-bitbucket/callback` |
| This is a private consumer | leave unchecked for the normal three-legged flow |

Bitbucket allows only one callback URL per consumer. For local development create a second consumer pointing at `http://localhost:3000/api/auth/plugin/atlassian-bitbucket/callback`.

### Tick the permissions

Check every scope in the table below. The checkboxes nest: selecting `repository:write` auto-selects `repository`, and `pipeline:write` auto-selects `pipeline`.

### Copy the credentials

Save, then expand the consumer in the list to reveal **Key** (the client id) and **Secret**.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `repository` | Read repositories, files, branches, and commits the user can see |
| `repository:write` | Write repository contents |
| `pullrequest:write` | Create, comment on, approve, merge, and decline pull requests |
| `pipeline` | Read Pipelines runs |
| `pipeline:write` | Trigger and stop Pipelines runs |
| `account` | Read account and workspace membership — backs workspace defaulting and user search |

> [!WARNING] Adding `pipeline` and `pipeline:write` forces a reconnect
> These two were added after the integration first shipped. Anyone who connected before must disconnect and reconnect. Existing tokens carry the old grant, and the three Pipelines tools return 403 until they do. Adding the scopes to the consumer is not enough on its own.

## Server configuration

```bash
ATLASSIAN_BITBUCKET_CLIENT_ID=...
ATLASSIAN_BITBUCKET_CLIENT_SECRET=...
```

## Connect

Portal: Connections → **Connect** on the Bitbucket card.

Agent:

```
connect({ integration: "atlassian-bitbucket" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `bitbucket_list_repos` | Slim repository rows for a workspace |
| `bitbucket_get_repo` | One repo, including its https clone URL and main branch |
| `bitbucket_create_pr` | Open a pull request from a source branch into a destination branch |
| `bitbucket_list_prs` | List pull requests by state, paged |
| `bitbucket_get_pr` | One PR with reviewers, approval status, and open-task counts |
| `bitbucket_get_pr_diff` | Full diff, or a per-file diffstat summary |
| `bitbucket_list_pr_comments` | Comments, with `{ path, line }` on inline ones |
| `bitbucket_add_pr_comment` | Post a general or inline comment |
| `bitbucket_approve_pr` | Approve as the connected user |
| `bitbucket_request_changes` | Mark the PR as changes-requested |
| `bitbucket_merge_pr` | Merge into the destination branch |
| `bitbucket_decline_pr` | Close the PR without merging |
| `bitbucket_list_pr_commits` | The PR's commits as slim rows |
| `bitbucket_get_file` | Raw file contents at a specific ref |
| `bitbucket_list_default_reviewers` | Who Bitbucket will auto-attach to new PRs |
| `bitbucket_search_users` | Resolve workspace members to UUIDs |
| `bitbucket_trigger_pipeline` | Start a default or custom pipeline on a ref |
| `bitbucket_get_pipeline` | Poll one pipeline's state and result |
| `bitbucket_stop_pipeline` | Stop a running pipeline |
| `bitbucket_get_clone_url` | Mint `https://x-token-auth:<token>@bitbucket.org/...` for clone, pull, or push |

## Notes and gotchas

> [!WARNING] Naming the PR author as a reviewer makes the create call fail
> Bitbucket rejects a pull request whose reviewer list includes its own author, and the failure is not obvious from the error. `bitbucket_create_pr` filters the author out of `reviewers` before sending. It also upserts: if an open PR already exists from the same source branch, the call updates that PR instead of creating a second one.

`bitbucket_get_file` needs a real ref. A branch name or a 40-character SHA works. The literal `HEAD` does not, on this API.

The token in `bitbucket_get_clone_url` is the user's live OAuth access token, embedded in a URL. It is short-lived, and the URL dies with it. Mint it immediately before use. Never persist it to a file, a remote, or shell history.

Bitbucket attaches a repository's default reviewers to new pull requests, so a PR can come back with reviewers you did not name. `bitbucket_list_default_reviewers` shows who those are for a repo.

Bitbucket issues short-lived access tokens and rotates refresh tokens (see [Atlassian's Bitbucket OAuth 2.0 documentation](https://developer.atlassian.com/cloud/bitbucket/oauth-2/) for current lifetimes). The server refreshes 30 seconds before expiry and stores each new refresh token automatically, keeping the previous one when the response carries none.
