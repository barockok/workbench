---
title: Confluence
description: Connect Atlassian Confluence Cloud so an agent can read, search, create, update, and delete wiki pages.
---

The Confluence integration lets an agent find a page by full-text search, read its body, write a new page into a space, and update or delete an existing one. It runs on Confluence REST v2 (`/wiki/api/v2/pages`, `/wiki/api/v2/spaces`); search stays on the CQL endpoint, which has no v2 equivalent.

## At a glance

| | |
|---|---|
| Plugin id | `atlassian-confluence` |
| Auth | OAuth 2.0 (3LO) |
| Tools | 6 |
| Authorization URL | `https://auth.atlassian.com/authorize` |
| Token URL | `https://auth.atlassian.com/oauth/token` |
| Proxy base | `https://api.atlassian.com/ex/confluence/cloud-id/wiki` |

`cloud-id` is a placeholder the server substitutes at request time from `/oauth/token/accessible-resources`. Note the `/wiki` suffix — Confluence requires it, Jira does not.

## Set up the OAuth app

> [!NOTE] The console steps are Atlassian's UI, not this server's
> Menu names, labels, and page URLs below come from Atlassian's console and change
> without notice. If what you see differs, follow [Atlassian's own documentation](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

The console is the same one Jira uses; only the API and scopes differ.

:::steps
### Create the app

[developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) → **Create** → **OAuth 2.0 integration**.

### Add the Confluence API with granular scopes

**Permissions** → **Confluence API** → **Add** → **Configure** → open the **Granular scopes** tab and tick the scopes in the table below.

If any classic scope (`read:confluence-content.summary` and friends) is already selected, untick it first. A 3LO app cannot mix classic and granular scopes — the console disables the granular checkboxes while a classic one is ticked.

### Set the callback URL

**Authorization** → **Configure** next to OAuth 2.0 (3LO):

```
https://<your-workbench-host>/api/auth/plugin/atlassian-confluence/callback
```

### Copy the credentials

**Settings** → **Authentication details** → Client ID and Secret.
:::

## Scopes

| Scope | What it is for |
|---|---|
| `read:page:confluence` | Read page bodies, versions, and metadata — backs `confluence_get_page` |
| `write:page:confluence` | Create and update pages |
| `delete:page:confluence` | Move a page to the space trash |
| `read:space:confluence` | Read space metadata and resolve a space key to its numeric id |
| `search:confluence` | CQL full-text search — backs `confluence_search_pages` |
| `offline_access` | Issue a refresh token |

> [!WARNING] The classic scopes no longer work
> `read:confluence-content.summary`, `write:confluence-content`, and `read:confluence-space.summary` authorize the v1 content API. This integration was migrated to REST v2 after v1 page reads stopped working against live sites: an app configured with the classic scopes connects successfully and then fails every page operation. Consult [Atlassian's Confluence REST documentation](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) for the API's current status. If you are carrying forward an older setup, swap to the granular scope set and have every user reconnect — changing scopes always requires reconsent.

## Server configuration

```bash
ATLASSIAN_CONFLUENCE_CLIENT_ID=...
ATLASSIAN_CONFLUENCE_CLIENT_SECRET=...
```

Even if one Atlassian app serves both products, Confluence reads its own variable pair. There is no shared `ATLASSIAN_*` fallback.

## Connect

Portal: Connections → **Connect** on the Confluence card.

Agent:

```
connect({ integration: "atlassian-confluence" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `confluence_search_pages` | Full-text search returning `{ id, title, spaceKey, version, url }` rows |
| `confluence_get_page` | One page with its storage-format body, version number, and space |
| `confluence_create_page` | Create a page in a space, optionally nested under a parent |
| `confluence_update_page` | Update title and body; requires the page's current version number |
| `confluence_delete_page` | Move a page to the space trash |
| `confluence_list_spaces` | List spaces as `{ key, name, id, url }` |

## Notes and gotchas

Page bodies are Confluence storage format, which is XHTML. Plain text works for simple pages; anything with structure has to be valid storage-format markup.

`confluence_update_page` takes the page's **current** version number, not the next one. The API stores version + 1 and rejects a stale number, so read the page with `confluence_get_page` immediately before updating rather than reusing a version from earlier in the conversation.

Space keys are the human-facing identifier but v2 addresses spaces by numeric id. The plugin resolves key to id internally; you can pass a `spaceId` directly to skip the lookup.

Deletion is a move to the space trash. It cannot be undone through this API — recovery is a manual restore in the Confluence UI.
