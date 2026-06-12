# a-workbench v0.13.0

_2026-06-12_

Headline: **Built-in plugins grow up** — 39 new tools close the create-but-can't-follow-up gap, every response is slimmed for token economy, and tool results are size-capped at the MCP layer.

## Features
- **Full lifecycle tools across plugins** (previously: could create an issue/PR/task, never follow up):
  - **Jira**: `update_issue`, `get_transitions`/`transition_issue` (move status), `add_comment`/`get_comments`, `list_projects`
  - **Bitbucket**: whole PR review set — `get_pr_diff` (+diffstat), `list_pr_comments`/`add_pr_comment` (incl. inline path+line), `approve_pr`, `request_changes`, `merge_pr`, `decline_pr`, `get_file`, `list_pr_commits`
  - **GitHub**: full PR review loop (`list_prs`, `get_pr`, `get_pr_diff`, comments, `merge_pr`, `create_pr_review`), issue lifecycle (`list/get/update_issue`, `add_issue_comment`), `search_code`/`search_issues`, `list_workflow_runs`
  - **Asana**: `get_task`, `update_task` (complete/assign/due), `add_comment`
  - **Gmail**: in-thread replies (`send` gains `threadId` + `In-Reply-To`/`References`), `modify` (markRead/archive/labels)
  - **Sheets**: `append` (write stays overwrite — both documented); **Calendar**: `freebusy`; **Slack**: `update_message`, `delete_message`
- **Temporary authenticated git clone URLs**: `bitbucket_get_clone_url` / `github_get_clone_url` mint token-bearing HTTPS URLs (`x-token-auth` / `x-access-token`) from the connection's OAuth token — self-expiring (~2h on Bitbucket), re-mint before pushing. Bitbucket manifest gains `repository:write` for push (reconnect to pick it up).

## Fixes
- **`confluence_get_page` 410**: Atlassian removed v1 `GET /content/{id}`; the tool now fetches via the still-alive CQL search endpoint (same workaround as `listSpaces`). Note: `confluence_update_page` now takes the page's **current** version (from `get_page`) and sends version+1.
- **Sheets search query injection**: user query was interpolated unescaped into the Drive `q` param; now escaped like drive/docs.
- **`jira_get_boards` 401**: manifest gains `read:board-scope:jira-software` (reconnect Jira to apply).
- **`jira_search_issues` / `google_gmail_list` bare IDs**: Jira search now defaults `fields=summary,status,assignee,priority,updated`; Gmail list enriches each page with From/Subject/Date metadata (maxResults capped at 25).
- **Bitbucket `workspace` no longer hard-required** — auto-discovers the user's first workspace.

## Changes
- **Token economy pass on every plugin**: responses are slim rows instead of raw upstream envelopes — avatars (4 sizes/user), etags, `_expandable`/`_links`, base64 SVG icons (~8KB per Jira project type), clone-link bloat all dropped. `bitbucket_list_repos` shrinks ~95%.
- **MCP-layer result cap**: text results over 60k chars are truncated with a notice telling the caller to narrow the request (limit/fields/pagination).
- **Description pass to the browser/jots standard**: every tool states what it returns, defaults, when to use vs siblings, and destructive-action warnings (merge/decline/delete).
- Docs: architecture meta-tools table updated for the v0.12.0 plugin split (browser/jots no longer listed as top-level MCP tools); browser examples now use the `execute_tool` dispatch form.

## Notes
- Tests: 552 passing (119 new across 9 suites). Findings docs: `docs/findings/2026-06-12-*.md`.
- Reconnect needed for: Jira (boards scope), Bitbucket (push via clone URL).
