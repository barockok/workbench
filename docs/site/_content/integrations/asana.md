---
title: Asana
description: Connect Asana so an agent can create, read, update, complete, and comment on tasks across projects.
---

The Asana integration covers the task loop: find a project, list or create tasks in it, read one back by gid, update or complete it, and comment on it. Everything is addressed by gid, so most workflows start with `asana_list_projects` or `asana_search_users`.

## At a glance

| | |
|---|---|
| Plugin id | `asana` |
| Auth | OAuth 2.0 |
| Tools | 8 |
| Authorization URL | `https://app.asana.com/-/oauth_authorize` |
| Token URL | `https://app.asana.com/-/oauth_token` |
| Proxy base | `https://app.asana.com/api/1.0` |

## Set up the OAuth app

> [!NOTE] The console steps are Asana's UI, not this server's
> Menu names, labels, and page URLs below come from Asana's console and change
> without notice. If what you see differs, follow [Asana's own documentation](https://developers.asana.com/docs) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the app

Open [app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) → **Create new app**. Name it, accept the API terms, create.

### Add the redirect URL

App → **OAuth** tab → Redirect URLs:

```
https://<your-workbench-host>/api/auth/plugin/asana/callback
```

Asana permits `http` for localhost, so add `http://localhost:3000/api/auth/plugin/asana/callback` for development.

### Keep Full permissions

Leave the app on Full permissions, which is what the `default` scope maps to. Do not switch it to granular scopes unless you also change the manifest — see the gotcha below.

### Copy the credentials

Same OAuth tab: **Client ID**, and **Client secret** via reveal.

### Distribute, if others will connect

**Manage Distribution** → choose Limited or Public. New apps are private to the creator's account.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `default` | Asana's full-permissions scope: the token can do anything the connecting user can do |

## Server configuration

```bash
ASANA_CLIENT_ID=...
ASANA_CLIENT_SECRET=...
```

## Connect

Portal: Connections → **Connect** on the Asana card.

Agent:

```
connect({ integration: "asana" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `asana_list_projects` | Projects as `{ gid, name }` rows, optionally scoped to a workspace |
| `asana_list_tasks` | Tasks in a project as slim rows with completion, due date, and assignee |
| `asana_create_task` | Create a task in a project and return its gid |
| `asana_get_task` | One task by gid, notes truncated to 2000 characters, with permalink |
| `asana_update_task` | Update fields, and complete or reopen via `completed` |
| `asana_add_comment` | Add a plain-text comment (story) to a task |
| `asana_list_teams` | Teams in an organization as `{ gid, name }` rows |
| `asana_search_users` | Resolve users to gids for assignment |

## Notes and gotchas

> [!WARNING] Granular-scope mode must match the manifest exactly
> The manifest requests the single scope `default`. Asana's app settings offer a full-permissions mode and a granular-scope mode, and `default` belongs to the former — switching the app to granular scopes while the manifest still requests `default` fails the authorize call, and so does the reverse. If you need granular scopes, change the manifest to match; [Asana's OAuth documentation](https://developers.asana.com/docs) describes the two modes.

Completing a task is an update, not a separate call: `asana_update_task` with `completed: true`. Passing `false` reopens it.

List tools return 10 rows by default. Raise `limit` when you expect more, rather than assuming a short list is the whole project.

The server refreshes an expired access token automatically and keeps the existing refresh token when Asana returns none. Token lifetimes are Asana's to set — see [Asana's OAuth documentation](https://developers.asana.com/docs) for the current values.

A 402 response means the endpoint requires a paid Asana plan. Asana also rate-limits per token, with the ceiling depending on the plan; the current figures are in [Asana's API documentation](https://developers.asana.com/docs).
