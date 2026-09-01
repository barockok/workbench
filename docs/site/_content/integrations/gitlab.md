---
title: GitLab
description: Connect gitlab.com or a self-hosted GitLab instance for projects, merge requests, and CI pipelines.
---

The GitLab integration is the only one that lets each user choose which server they are connecting to. Projects, files, issues, merge requests with inline review, and CI pipelines all work the same against gitlab.com and against a self-hosted instance — the difference is a per-connection instance URL that the server swaps into every API call and every OAuth endpoint.

## At a glance

| | |
|---|---|
| Plugin id | `gitlab` |
| Auth | OAuth 2.0 with a per-connection `instance` field |
| Tools | 31 |
| Authorization URL | `https://gitlab.com/oauth/authorize` (cloud default) |
| Token URL | `https://gitlab.com/oauth/token` (cloud default) |
| Proxy base | Resolved per request: the connection's instance origin + `/api/v4` |

The manifest declares an `instance` field labelled "GitLab instance URL", with the default `https://gitlab.com`. At connect time the portal shows a browser prompt using that label, prefilled with the default; submitting it blank keeps the default.

## How the origin swap works

The server keeps the manifest URL's **path and query** and replaces only the origin. `https://gitlab.com/oauth/authorize` against an instance of `https://gitlab.acme.com` becomes `https://gitlab.acme.com/oauth/authorize`. The same swap applies to the token exchange and to every later refresh, and the chosen origin is stored on the connection so tools build their API base from it.

An entered instance URL must be **https**, must carry no `user:pass@` userinfo, and must not be a private, loopback, or link-local literal. Path, query, and fragment are discarded — only the origin survives.

> [!WARNING] One cloud OAuth app cannot authorize a self-hosted instance
> Every GitLab instance has its own application registry, and OAuth endpoints are per-instance. An application created on gitlab.com is unknown to `gitlab.acme.com` and vice versa. Register the application on whichever instance your users will connect to. The deployment holds a single `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` pair, so every instance it talks to must share that client id and secret — practical when you control the instances, not when they are unrelated.

## Set up the OAuth app

> [!NOTE] The console steps are GitLab's UI, not this server's
> Menu names, labels, and page URLs below come from GitLab's console and change
> without notice. If what you see differs, follow [GitLab's own documentation](https://docs.gitlab.com/) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the application

Cloud, per user: [gitlab.com/-/user_settings/applications](https://gitlab.com/-/user_settings/applications).
Cloud, group-owned (better for teams): Group → **Settings → Applications**.
Self-hosted: the same paths under your instance origin; instance-wide applications live under **Admin → Applications**.

### Fill in the fields

| Field | Value |
|---|---|
| Name | your deployment name |
| Redirect URI | `https://<your-workbench-host>/api/auth/plugin/gitlab/callback` |
| Confidential | on |
| Scopes | `api` |

GitLab accepts multiple redirect URIs, one per line, so add `http://localhost:3000/api/auth/plugin/gitlab/callback` to the same application for local development.

### Copy the credentials

Save, then copy the **Application ID** (client id) and the **Secret**.

### Allowlist any self-hosted origins

Set `GITLAB_ALLOWED_INSTANCES` on the server before users try to connect to anything other than gitlab.com.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `api` | Full read and write across projects, repository files, issues, merge requests, and pipelines, plus git push over HTTPS |

`api` is what gives parity with the GitHub and Bitbucket integrations. `read_api` and `read_repository` are narrower alternatives if you only ever want reads, but the write tools and `gitlab_get_clone_url` push then stop working.

## Server configuration

```bash
GITLAB_CLIENT_ID=<application id>
GITLAB_CLIENT_SECRET=<secret>
# Self-hosted only. Comma-separated https origins. gitlab.com is always allowed.
GITLAB_ALLOWED_INSTANCES=https://gitlab.acme.com
```

> [!WARNING] Without the allowlist, only gitlab.com is accepted
> The instance origin a user types receives the server's token POST, which carries your shared client secret. Letting any user point that at an arbitrary host would leak the secret and give them an SSRF primitive. So an entered instance is rejected unless it is the manifest's cloud default or appears in `GITLAB_ALLOWED_INSTANCES`.

## Connect

Portal: Connections → **Connect** on the GitLab card → the prompt asks for the instance URL, prefilled with `https://gitlab.com` → consent on that instance.

Agent:

```
connect({ integration: "gitlab" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `gitlab_list_projects` | The authenticated user's projects as slim rows |
| `gitlab_get_project` | One project's metadata and http clone URL |
| `gitlab_list_branches` | Branches with default, protected, and merged flags |
| `gitlab_list_commits` | Commits newest-first from an optional ref |
| `gitlab_list_releases` | Releases newest-first |
| `gitlab_get_file` | Raw file text at a required ref |
| `gitlab_create_or_update_file` | Commit a file, auto-detecting create versus update |
| `gitlab_create_issue` | Create an issue; note the returned `iid` |
| `gitlab_list_issues` | List issues, default state opened |
| `gitlab_get_issue` | One issue, description truncated to 2000 characters |
| `gitlab_update_issue` | Change title, description, labels, or open/closed state |
| `gitlab_add_issue_comment` | Add a note to an issue |
| `gitlab_create_mr` | Open a merge request from source into target |
| `gitlab_list_mrs` | List merge requests by state |
| `gitlab_get_mr` | One MR with `merge_status` and vote counts |
| `gitlab_get_mr_diff` | Full diff, or a per-file summary with `diffstat:true` |
| `gitlab_list_mr_commits` | The MR's commits as slim rows |
| `gitlab_list_mr_comments` | Notes, flagged `system` for GitLab's auto-events |
| `gitlab_add_mr_comment` | General note, or an inline discussion anchored to a line |
| `gitlab_approve_mr` | Approve as the connected user |
| `gitlab_merge_mr` | Merge into the target branch |
| `gitlab_close_mr` | Close without merging |
| `gitlab_list_pipelines` | CI pipelines newest-first, filterable by ref and status |
| `gitlab_trigger_pipeline` | Start a pipeline on a ref with optional CI variables |
| `gitlab_get_pipeline` | Poll one pipeline's status |
| `gitlab_retry_pipeline` | Retry failed and canceled jobs |
| `gitlab_cancel_pipeline` | Cancel a running pipeline |
| `gitlab_search_projects` | Search projects by name or path |
| `gitlab_search_code` | Search blobs, instance-wide or scoped to a project |
| `gitlab_search_issues` | Search issues instance-wide or in a project |
| `gitlab_get_clone_url` | Mint `https://oauth2:<token>@host/path.git` for clone, pull, or push |

## Notes and gotchas

Issues and merge requests are addressed by `iid`, the per-project number you see in the UI, not the global `id`. Mixing them up produces confusing 404s.

Instance-wide `gitlab_search_code` depends on GitLab's advanced search being enabled on the instance — see [GitLab's documentation](https://docs.gitlab.com/) for what that requires on your version and tier. Scoping the search to a `project` avoids the dependency and is faster.

A `gitlab_approve_mr` 404 usually means merge-request approvals are not available on that instance; GitLab gates the feature by tier, so check [GitLab's documentation](https://docs.gitlab.com/) for the instance's version.

401s on every call immediately after connecting almost always mean the wrong instance URL was entered, or the application lives on a different instance than the one the user typed.

`gitlab_get_clone_url` embeds the live access token in the URL. It expires with the token; mint it immediately before use.
