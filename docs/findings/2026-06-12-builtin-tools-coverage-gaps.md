# Built-in tools coverage gaps — create-but-can't-follow-up pattern

**Date:** 2026-06-12
**Status:** implemented 2026-06-12 — all gaps below filled (jira lifecycle, bitbucket review set, github review+issue lifecycle+search+actions, asana lifecycle, gmail thread reply+modify, sheets append, calendar freebusy, slack update/delete).
**Scope:** gap analysis across all built-in plugins (companion to [2026-06-12 builtin tools round review](2026-06-12-builtin-tools-round-review.md), which covers quality of *existing* tools; this covers what's *missing*).

## The pattern

Three plugins ship the entry-point write but none of the lifecycle that follows:

- **GitHub:** `create_issue` / `create_pr` exist, but no `list_prs`, `get_pr`, issue read/update/comment — open a PR, then blind.
- **Asana:** `create_task` exists, but no `get_task` / `update_task` — can create a task, never complete one.
- **Bitbucket:** `create_pr` / `list_prs` / `get_pr` exist, but no diff, comments, approve, or merge — can open a PR, can't review one.

## Per-plugin gaps (priority order)

### 1. GitHub (biggest hole)

| Missing | Why |
|---|---|
| `list_prs` / `get_pr` / `get_pr_diff` / PR comments / `merge_pr` | Whole review loop absent — worse than Bitbucket |
| `list_issues` / `update_issue` / `add_issue_comment` | Has create only; can't read or follow up own issues |
| `search_code` / `search_issues` | No discovery |
| Actions: `list_workflow_runs` / `get_run` | CI status — common agent ask |

### 2. Bitbucket (scopes already sufficient — `repository`, `pullrequest:write`)

| Missing | Endpoint |
|---|---|
| `get_pr_diff` | `GET /pullrequests/{id}/diff` (or `/diffstat`, cheaper) |
| `list_pr_comments` / `add_pr_comment` (inline path+line) | `/pullrequests/{id}/comments` |
| `approve_pr` / `request_changes` | `POST /pullrequests/{id}/approve`, `/request-changes` |
| `merge_pr` / `decline_pr` | `POST /pullrequests/{id}/merge`, `/decline` |
| `get_file` (source at ref) | `GET /src/{commit}/{path}` |
| `list_pr_commits` | `/pullrequests/{id}/commits` |

Native Bitbucket issue tracker (`/issues`, `issue:write` scope) deliberately skipped — tickets belong in Jira.

### 3. Jira (existing scopes `write:jira-work`/`read:jira-work` cover all of these — no reconnect)

| Missing | Endpoint |
|---|---|
| `update_issue` | `PUT /rest/api/3/issue/{key}` |
| `transition_issue` + `get_transitions` | `POST /issue/{key}/transitions` — top agent op, no way to move status today |
| `add_comment` / `get_comments` | `/issue/{key}/comment` |
| `list_projects` | `GET /rest/api/3/project/search` — no project-key discovery today (`project_types` doesn't help) |

Sprint/board ops need `read:board-scope:jira-software` (same scope blocking `jira_get_boards`) — bundle with that reconnect or skip.

### 4. Asana

`get_task`, `update_task` (complete / assign / due date), `add_comment` (stories API).

### 5. Gmail

- `send` builds raw MIME with no `threadId` (gmail.ts:15-22) → **every reply forks a new conversation**. Add `threadId` + `In-Reply-To`/`References` headers.
- No `modify` (mark read, archive, add/remove labels), no attachment download.

### 6. Sheets

`write` is PUT values = overwrite only (sheets.ts:30). Missing `append` (`POST …/values/{range}:append`) — the log-a-row case is the most common agent write. No add-tab either.

### 7. Second tier

- **Calendar:** `freebusy` (availability before scheduling), respond-to-invite (accept/decline).
- **Slack:** `update_message` / `delete_message` (agents editing own progress messages).

### Fine as-is

Docs, Slides, Drive (maybe move/rename later), Gemini, Confluence (surface complete — its problem is broken endpoints, see [2026-06-12 confluence v1 content GET removed](2026-06-12-confluence-v1-content-get-removed.md)), httpbin (test plugin).

## Build order suggestion

1. Jira lifecycle set (update/transition/comment/list_projects) — one file, no scope change
2. Bitbucket review set (diff/comments/approve/merge) — no scope change
3. GitHub review + issue lifecycle
4. Asana lifecycle, Gmail thread-reply + modify, Sheets append
5. Calendar freebusy, Slack edit
