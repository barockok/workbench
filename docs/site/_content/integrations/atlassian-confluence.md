---
title: Confluence
description: Connect Atlassian Confluence Cloud so an agent can read, search, create, update, and delete wiki pages.
---

The Confluence integration lets an agent find a page by full-text search and read its body. It can also write a new page into a space, and update or delete an existing one. It runs on Confluence REST v2: `/wiki/api/v2/pages` and `/wiki/api/v2/spaces`. Search stays on the CQL endpoint, which has no v2 equivalent.

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

The console is the same one Jira uses. Only the API and scopes differ.

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
| `read:attachment:confluence` | List the files attached to a page — backs the `attachments` field on `confluence_get_page` |
| `search:confluence` | CQL full-text search — backs `confluence_search_pages` |
| `offline_access` | Issue a refresh token |

> [!WARNING] The classic scopes no longer work
> `read:confluence-content.summary`, `write:confluence-content`, and `read:confluence-space.summary` authorize the v1 content API. This integration moved to REST v2 after v1 page reads stopped working against live sites. An app configured with the classic scopes connects successfully, then fails every page operation. Consult [Atlassian's Confluence REST documentation](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) for the API's current status. If you are carrying forward an older setup, swap to the granular scope set and have every user reconnect. Changing scopes always requires reconsent.

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
| `confluence_search_pages` | Full-text or raw-CQL search returning `{ id, title, spaceKey, version, url }` rows |
| `confluence_get_page` | One page with its storage-format body, version number, space, and attachment list |
| `confluence_create_page` | Create a page in a space, optionally nested under a parent |
| `confluence_update_page` | Update title and body; requires the page's current version number |
| `confluence_delete_page` | Move a page to the space trash |
| `confluence_list_spaces` | List spaces as `{ key, name, id, url }` |

## Notes and gotchas

`confluence_search_pages` takes either `query` for a plain full-text match or `cql` for a raw [CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) expression — space, label, date and title filters, boolean logic, `ORDER BY`. Pass exactly one; `cql` wins if both are given, and a malformed expression returns the upstream error rather than an empty list. A `cql` string is passed through untouched, so it needs its own `type = page` clause if you want one.

Search and space listing are both cursor-paginated. When `hasMore` is true the response also carries `nextCursor`; call again with the same query and `cursor` set to that value for the next page. The cursor is opaque — pass it back unmodified.

`confluence_get_page` also returns `attachments`: the files attached to or embedded in the page, each with a `downloadUrl`. Attachments and diagram macros never appear in the storage-format body, so a section that is only a draw.io diagram reads as an empty gap without them. The lookup is best-effort — the field is omitted entirely if it failed (an older token minted before `read:attachment:confluence` was added, for instance), as opposed to `[]` for a page that genuinely has none.

Page bodies are Confluence storage format, which is XHTML. Plain text works for simple pages. Anything with structure has to be valid storage-format markup.

`confluence_update_page` takes the page's **current** version number, not the next one. The API stores version + 1 and rejects a stale number. Read the page with `confluence_get_page` immediately before you update it. Do not reuse a version from earlier in the conversation.

Space keys are the human-facing identifier but v2 addresses spaces by numeric id. The plugin resolves key to id internally. You can pass a `spaceId` directly to skip the lookup.

Deletion is a move to the space trash. It cannot be undone through this API — recovery is a manual restore in the Confluence UI.
