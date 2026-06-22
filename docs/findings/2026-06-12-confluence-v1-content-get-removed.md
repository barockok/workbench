# Confluence v1 `GET /rest/api/content/{id}` removed — get_page returns 410

**Date:** 2026-06-12
**Where:** `packages/plugins/atlassian-confluence/tools/index.ts` (`confluence_get_page`)
**Status:** SUPERSEDED 2026-06-22 — the whole integration moved to REST v2; `get_page` now uses `GET /wiki/api/v2/pages/{id}?body-format=storage` (no more CQL workaround). See [2026-06-22 confluence v2 migration](2026-06-22-confluence-v2-migration.md). Historical fix (2026-06-12): get_page fetched via the CQL search endpoint (`cql=id=<pageId>&expand=body.storage,version,space`); `confluence_update_page` took the page's CURRENT version and sent version+1 (still true under v2).

## Symptom

`confluence_get_page` fails on a valid page ID with HTTP 410:

```
com.atlassian.confluence.api.service.exceptions.pagesmodes.GoneException: This deprecated endpoint has been removed.
```

The response body shows `authorized: true, valid: true` — auth is fine; the endpoint itself is gone. (Easily misread as an auth problem: in the same session the integration had also gone NOT_CONNECTED, which surfaced as a 401 to the caller. Two separate issues.)

## Cause

Atlassian removed the deprecated Confluence v1 endpoint `GET /wiki/rest/api/content/{id}`. Same removal wave that took out `GET /wiki/rest/api/space` (see the `listSpaces` workaround comment in the plugin, added earlier). The proper replacement, v2 `GET /wiki/api/v2/pages/{id}`, requires granular scopes (`read:page:confluence`) that aren't selectable while the OAuth app uses classic scopes.

## Status of sibling tools (tested 2026-06-12)

- `confluence_search_pages` (`GET /rest/api/content/search?cql=…`) — **works**
- `confluence_list_spaces` (CQL `type=space` via `/rest/api/search`) — **works** (already migrated)
- `confluence_get_page` — **410, broken**
- `confluence_create_page` (POST `/rest/api/content`), `confluence_update_page` (PUT `/rest/api/content/{id}`), `confluence_delete_page` (DELETE) — same v1 content family, **untested** (write ops against company Confluence); likely affected by the same removal wave.

## Fix direction

Follow the `listSpaces` precedent: `confluence_get_page` can use the still-alive CQL search endpoint with an id filter and expansion, e.g.

```
GET /wiki/rest/api/content/search?cql=id=<pageId>&expand=body.storage,version,space
```

which only needs the already-granted `search:confluence` scope. Longer term, migrate the app to granular scopes and the v2 pages API — v1 search/CQL endpoints are also on Atlassian's deprecation track.
