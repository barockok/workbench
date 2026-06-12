# Built-in tools round review — raw passthrough everywhere, several broken/bloated tools

**Date:** 2026-06-12
**Scope:** built-in plugins only (packages/plugins/* + internal browser/jots), live-tested against real connections (13 integrations connected).
**Status:** all fix directions implemented 2026-06-12 — sheets escaping, jira scope/fields/icon strip, gmail metadata enrichment, response shaping across plugins, bitbucket workspace auto-discovery, MCP-layer 60k-char result cap, description pass. Jira boards fix needs a reconnect to pick up the new scope.

## Broken / misleading tools (live-verified)

| Tool | Symptom | Cause |
|---|---|---|
| `jira_get_boards` | `401 "Unauthorized; scope does not match"` | Agile API (`/rest/agile/1.0/board`) needs `read:board-scope:jira-software`; manifest only grants classic `read:jira-work` family (manifest.ts:12-18) |
| `jira_search_issues` | Returns `{"issues":[{"id":"139262"}]}` — IDs only, no key/summary/status | New `/rest/api/3/search/jql` endpoint returns bare IDs unless `fields` requested; tool doesn't expose/default a `fields` param |
| `google_gmail_list` | IDs only (`{id, threadId}`) | Gmail list API natural behavior; tool doesn't follow up with metadata batch or expose `format` — forces N× `google_gmail_get` calls |
| `confluence_get_page` | 410 Gone | See [2026-06-12 confluence v1 content GET removed](2026-06-12-confluence-v1-content-get-removed.md) |

## Token-economy offenders (live-measured)

- `jira_project_types`: ~8 KB **base64 SVG icons** in response — strip `icon` field.
- `bitbucket_list_repos`: ~30 KB for 10 repos — full raw Bitbucket payload (links/avatars/clone URLs/owner/workspace nested objects). ~95% strippable.
- `google_calendar_list_calendars` / `google_drive_list`: raw Google payloads — etags, notificationSettings, conferenceProperties, ~600-char nextPageTokens.
- `confluence_search_pages` / `list_spaces`: raw Atlassian envelope — `_expandable`, `_links`, `breadcrumbs`, `iconCssClass` per row.
- `jira_search_users` / `slack_list_users`: 4 avatar URL sizes per user.

Pattern: every handler ends `return res.json()` — zero shaping except google-docs plaintext, slides markdown, calendar delete. No size cap at MCP layer either (`packages/server/src/mcp/server.ts` ~line 81 stringifies result unchecked).

## Bug: query injection in sheets search

`google_sheets_search` interpolates `args.query` unescaped into the Drive `q` param (`name contains '${args.query}'`, sheets.ts). google-drive and google-docs search escape quotes/backslashes; sheets was missed. Low severity (read-only scope) but a quote in the query breaks the call.

## What good looks like (already in repo)

- Internal `browser_*` / `deploy_jot` descriptions: defaults, cost warnings, when-to-use-X-instead-of-Y. Gold standard.
- `google_sheets_search` uses Drive `fields=` projection — only id/name/modifiedTime per file. The pattern to copy everywhere.
- External internal-app plugin descriptions (row-size warnings, required-param notes, cross-tool pointers) show the target quality bar.

## Fix directions (priority)

1. Escape `args.query` in sheets search (copy drive.ts escaping).
2. Jira: add `read:board-scope:jira-software` scope (requires reconnect) or drop boards tool; default `fields=summary,status,assignee,priority,updated` in search; strip `icon` from project types.
3. Gmail list: fetch metadata (From/Subject/Date) for the page of IDs, or expose `format`/`fields`.
4. Shape list responses: pick id/name/key/state-level fields, use upstream projection (`fields=` for Google, `_fields` unsupported on Bitbucket → manual pick).
5. Bitbucket: default `workspace` (discover via `/2.0/workspaces` on connect, or config), don't hard-require.
6. MCP layer: size cap + truncation notice on tool results.
7. Description pass: bring API plugins to browser/jots standard (defaults, size warnings, when-to-use).
