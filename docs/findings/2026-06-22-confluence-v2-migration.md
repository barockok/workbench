# Confluence integration migrated from REST v1 → v2

**Date:** 2026-06-22
**Where:** `packages/plugins/atlassian-confluence/{tools/index.ts,manifest.ts}`
**Status:** done — all page/space ops now run on Confluence Cloud REST **v2**.
Supersedes the v1 `get_page` CQL workaround in
[2026-06-12 confluence v1 content GET removed](2026-06-12-confluence-v1-content-get-removed.md).

## Why

`confluence_create_page` (and the rest of the v1 content family,
`/wiki/rest/api/content...`) returns HTTP **410**:

```
GoneException: "This deprecated endpoint has been removed."
```

Atlassian is removing the v1 content API (RFC-19). Reads (`get_page` via the v1
CQL workaround, `search`, `list_spaces`) still answered but are the same v1
generation and on the same removal track — so the whole integration moved to v2,
not just writes.

## What changed (v1 → v2 call map)

| Tool | v1 (before) | v2 (after) |
|------|-------------|------------|
| create_page | `POST /wiki/rest/api/content` | `POST /wiki/api/v2/pages` |
| update_page | `PUT /wiki/rest/api/content/{id}` | `PUT /wiki/api/v2/pages/{id}` |
| get_page | CQL `id=` workaround on `/content/search` | `GET /wiki/api/v2/pages/{id}?body-format=storage` |
| delete_page | `DELETE /wiki/rest/api/content/{id}` | `DELETE /wiki/api/v2/pages/{id}` (204) |
| list_spaces | CQL `type=space` on `/rest/api/search` | `GET /wiki/api/v2/spaces` |
| search_pages | `GET /wiki/rest/api/content/search?cql=…` | `GET /wiki/rest/api/search?cql=…` (kept — v2 has no full-text search) |

The MCP tool **contracts are unchanged**: same tool names, same external args
(`create_page`→`spaceKey`, `update_page`→`pageId`/`version`, …) and the same slim
output fields consumers parse (`id`, `title`, `spaceKey`, `version`, `body`, `url`).

## Gotchas handled

1. **spaceKey → spaceId.** v2 `create` needs the numeric `spaceId`; the tool still
   takes `spaceKey`. Resolved internally via `GET /wiki/api/v2/spaces?keys={key}`,
   cached per `(userId, key/id)` in a module-level map. `spaceId` was also added as
   an **optional** input fast-path. A reverse `spaceId → spaceKey` lookup keeps the
   `spaceKey` field populated on get/update outputs (best-effort, never throws).
2. **Body wrapper.** v1 `body.storage.value` → v2 `body:{ representation:"storage",
   value }`. Callers still pass storage XHTML unchanged.
3. **Version on update.** Input `version` is still the page's CURRENT version; the
   handler sends `version.number = version + 1` (optional `message` annotates
   history). v2 PUT also requires `id` and `status:"current"` in the body — both sent.
4. **Pagination.** v2 is cursor-based; `hasMore` is derived from `_links.next`, not
   start/limit offsets.
5. **64-bit IDs.** v2 page IDs are long numeric strings; the numeric regex on
   `pageId` allows any length (no 9-digit assumption).
6. **Errors.** A `readJson()` helper throws on any non-2xx with the real status +
   body slice — no silent 4xx/410 "success". The executor surfaces it as `{ error }`.

## Scopes — REQUIRES RECONNECT

v2 needs **granular** scopes; the classic `*:confluence-content` scopes only
authorize the dead v1 API. `manifest.ts` now requests:

```
read:page:confluence  write:page:confluence  delete:page:confluence
read:space:confluence  search:confluence  offline_access
```

Existing connections were consented under the old classic scopes → **users must
reconnect** for v2 writes to authorize. (`search:confluence` was already granular
and backs the CQL search endpoint that `search_pages` still uses. The per-user
cloud-id resolver still matches: accessible-resources scopes contain
`…:confluence`.)

## Testing

- Unit: `packages/server/tests/confluence-tools.test.ts` rewritten for v2 shapes
  (10 tests) — resolver call order, v2 body wrapper, `version+1`, 404→error,
  cursor `hasMore`, CQL escaping. Full server suite green (657 tests).
- Live: requires a connected Confluence site (reconnect for the new scopes). Run via
  the MCP `execute_tools` interface against a throwaway space:
  `list_spaces` → `create_page` (expect an id, no 410) → `get_page` (storage body) →
  `update_page` (version increments) → `search_pages` → `delete_page`.
  Not executable from the source sandbox (no live OAuth connection here).
