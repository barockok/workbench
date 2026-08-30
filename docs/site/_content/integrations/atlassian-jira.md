---
title: Jira
description: Connect Atlassian Jira Cloud so an agent can create, search, update, comment on, and transition issues.
---

The Jira integration gives an agent the issue lifecycle: discover projects, search with JQL, read an issue in full, create one, assign it, comment on it, and move it through its workflow. Descriptions and comments are plain text — the plugin wraps and unwraps Atlassian Document Format for you.

## At a glance

| | |
|---|---|
| Plugin id | `atlassian-jira` |
| Auth | OAuth 2.0 (3LO) |
| Tools | 12 |
| Authorization URL | `https://auth.atlassian.com/authorize` |
| Token URL | `https://auth.atlassian.com/oauth/token` |
| Proxy base | `https://api.atlassian.com/ex/jira/cloud-id` |

The literal `cloud-id` in the proxy base is a placeholder. At request time the server calls `/oauth/token/accessible-resources` with the user's token, substitutes the real cloud id, and caches it per user for the life of the process.

## Set up the OAuth app

> [!NOTE] The console steps are Atlassian's UI, not this server's
> Menu names, labels, and page URLs below come from Atlassian's console and change
> without notice. If what you see differs, follow [Atlassian's own documentation](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the app

Open [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) → **Create** → **OAuth 2.0 integration**. Name it, accept the terms, create.

### Add the Jira API and its scopes

Left menu → **Permissions** → **Jira API** → **Add**, then **Configure**. Tick every scope in the table below.

### Set the callback URL

Left menu → **Authorization** → **Configure** next to OAuth 2.0 (3LO). Paste exactly:

```
https://<your-workbench-host>/api/auth/plugin/atlassian-jira/callback
```

Atlassian accepts `http://localhost` for development:

```
http://localhost:3000/api/auth/plugin/atlassian-jira/callback
```

### Copy the credentials

Left menu → **Settings** → **Authentication details**. Copy the **Client ID** and reveal the **Secret**.

### Distribute (only if others will connect)

Apps default to Development status, where only you can install. **Distribution** → switch to **Sharing**, supply a privacy policy URL, save.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `read:jira-work` | Read issues, projects, comments, and workflow transitions |
| `write:jira-work` | Create and edit issues, apply transitions, post comments |
| `read:board-scope:jira-software` | Read agile boards via `/rest/agile/1.0/board` — backs `jira_get_boards` |
| `read:me` | Identify the authorizing account at callback time |
| `read:jira-user` | Search user profiles — backs `jira_search_users` |
| `offline_access` | Issue a refresh token; without it the connection dies at the first access-token expiry |

> [!WARNING] `read:board-scope:jira-software` cannot be granted on a 3LO app
> As of this writing the Jira Software API is not among the API rows the console lets you add to a standard OAuth 2.0 (3LO) app — check [Atlassian's 3LO documentation](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) for the current list, which is Atlassian's to change. The manifest requests the scope so it works the moment Atlassian exposes it; until then `jira_get_boards` returns `Unauthorized; scope does not match`. Every other Jira tool is unaffected.

## Server configuration

```bash
ATLASSIAN_JIRA_CLIENT_ID=...
ATLASSIAN_JIRA_CLIENT_SECRET=...
```

If you register one Atlassian app covering both Jira and Confluence, you still set both variable pairs to the same values — the server derives the prefix from the plugin name and never falls back to a shared `ATLASSIAN_*` pair.

## Connect

From the portal: sign in, open Connections, press **Connect** on the Jira card, approve the Atlassian consent screen.

From an agent:

```
connect({ integration: "atlassian-jira" })
→ { connectionId, type: "oauth2", url }

wait_for_connection({ connectionId })
→ { status: "CONNECTED" }
```

Open the returned `url` to consent. The pending connection expires after `CONNECT_TTL_SECONDS` (default 600).

## Tools

| Tool | Purpose |
|---|---|
| `jira_list_projects` | List visible projects as `{ key, id, name, projectTypeKey }`; the way to discover a project key |
| `jira_create_issue` | Create an issue and return `{ id, key, self }`; issue type defaults to Task |
| `jira_search_issues` | JQL search returning slim rows plus a `nextPageToken` for paging |
| `jira_get_issue` | One issue in detail, description flattened from ADF to plain text |
| `jira_update_issue` | Change summary, description, assignee, or labels — only the fields you pass |
| `jira_get_transitions` | List the transitions currently legal for an issue, with their ids |
| `jira_transition_issue` | Apply a transition id to move an issue's status |
| `jira_add_comment` | Add a plain-text comment, wrapped in ADF automatically |
| `jira_get_comments` | Read a comment thread oldest-first, ADF flattened to plain text |
| `jira_search_users` | Find users by name or email; returns the `accountId` assignment needs |
| `jira_get_boards` | List agile boards, optionally filtered by project key |
| `jira_project_types` | List the site's project types with icons stripped |

## Notes and gotchas

Transition ids are not stable identifiers. They vary per workflow *and* per the issue's current status, so `jira_get_transitions` must be called against the same issue immediately before `jira_transition_issue`.

When Atlassian returns a new refresh token on a refresh, the server stores it and discards the old one — so an out-of-band copy of a refresh token goes stale as soon as the server rotates it. If no new token comes back, the existing one is kept.

A 401 against `<site>.atlassian.net` in a debugging session usually means the cloud id was not resolved. Tools always go through `api.atlassian.com/ex/jira/<cloud-id>/`; the direct site host is not usable with a 3LO token.

If Jira answers `403 OAUTH_2_FORBIDDEN`, check the connecting user's project and issue permissions in Jira before touching the scope list; the scopes the server requests are the ones in the table above and are fixed at the manifest. Atlassian defines what the code means — see [their 3LO documentation](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).
