# a-workbench v0.18.0

_2026-06-23_

Headline: **Confluence plugin fully migrated to REST API v2 — v1 content endpoints are gone.**

## Fixes

- **Confluence REST API v1 → v2 migration** — Atlassian removed the entire v1 content family (`/wiki/rest/api/content/*`), which 410'd with `GoneException: "This deprecated endpoint has been removed."`. All page and space operations now run on v2 (`/wiki/api/v2/pages`, `/wiki/api/v2/spaces`). Full-text search stays on the still-supported CQL search endpoint (`/wiki/rest/api/search`). (`packages/plugins/atlassian-confluence/tools/index.ts`)
- **spaceKey → spaceId resolution** — v2 page ops require a numeric `spaceId`; added an in-memory cache that resolves `spaceKey ↔ spaceId` with a single lookup per key, keyed by `userId` so multi-tenant sessions stay isolated.
- **CQL injection prevention** — `escapeCql()` escapes `\` and `"` in user-supplied search terms before interpolating into double-quoted CQL literals.
- **Error detail capped at 200 chars** — `readJson` now slices upstream error bodies to 200 characters, reducing error leakage surface.

## Scope changes

OAuth scopes updated from classic (`write:confluence-content`) to granular v2 scopes required by the new endpoints:

| Added | Removed |
|---|---|
| `read:page:confluence` | `read:confluence-content.summary` |
| `write:page:confluence` | `write:confluence-content` |
| `delete:page:confluence` | `read:confluence-space.summary` |
| `read:space:confluence` | |

**Action required:** users must reconnect their Atlassian Confluence connection to pick up the new scopes.

## New tools

- `confluence_delete_page` — delete a page by ID (moves to space trash).

## Tests

- Comprehensive test suite for all Confluence v2 tool handlers. (`packages/server/tests/confluence-tools.test.ts`)
