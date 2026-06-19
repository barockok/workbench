# a-workbench v0.17.0

_2026-06-19_

Headline: **New Relic plugin + generic API-key auth — observe and alert via NerdGraph, connect any key-based SaaS integration.**

## Features

- **New Relic plugin** — full NerdGraph coverage: `newrelic_run_nrql` (arbitrary NRQL reads), `newrelic_search_entities` (entity discovery by name/domain/type), `newrelic_get_dashboard` (fetch pages + widgets by GUID), `newrelic_create_alert_policy`, `newrelic_create_static_nrql_condition` (with `EVENT_TIMER`/`EVENT_FLOW`/`CADENCE` support), `newrelic_add_tags_to_entity`, `newrelic_add_widgets_to_dashboard_page`, `newrelic_configure_cloud_integration`, `newrelic_create_ai_notifications_destination/channel`, `newrelic_create_ai_workflow`. Authenticates via User API Key (`Api-Key` header); region-scoped to US or EU NerdGraph endpoint. (`packages/plugins/newrelic/`)
- **Generic API-key auth flow** — `ApiKeyConfig` is now wired end-to-end: manifest `fields[]` (one `secret: true` field + arbitrary config fields), server `POST /api/auth/apikey/:integration` (validates + stores encrypted), `ctx.http` apikey branch (attaches key verbatim, no Bearer prefix), portal `ApiKeyAuthModal` (renders field spec, POSTs values). Connect is synchronous — no PENDING record. (`packages/shared/src/types.ts`, `packages/server/src/api/routes.ts`, `packages/server/src/plugins/context.ts`, `packages/portal/src/components/ApiKeyAuthModal.tsx`)

## Security

- **`allowedHosts` on `ApiKeyConfig`** — optional `string[]` on the manifest; when set, `ctx.http` enforces an exact/subdomain match before attaching the credential, blocking SSRF and credential forwarding to non-declared hosts. New Relic pins `["api.newrelic.com", "api.eu.newrelic.com"]`. Plugin contract documented on the type for integrations that omit it. (`packages/shared/src/types.ts`, `packages/server/src/plugins/context.ts`)

## Tests

- 26 new unit tests for New Relic tools (endpoint routing, alert policy/condition, entity search, AI notifications, dashboard widgets). (`packages/server/tests/newrelic-tools.test.ts`)
- 2 new `ctx.http` apikey branch tests: allowed host attaches key, blocked host throws before `fetch`. (`packages/server/tests/context.test.ts`)
- `allowedHosts` schema validation tests. (`packages/shared/tests/schemas.test.ts`)

## Dev tooling

- `packages/server/scripts/verify-newrelic.ts` — standalone smoke test against live NerdGraph; `--create` flag exercises a real alert-policy mutation.
- `packages/server/scripts/seed-local-user.ts` — seed a local user + API key for testing without Google SSO.

## Upgrade notes

- Additive release — no breaking changes. Existing connections work without reconnect.
- To connect New Relic: open the portal, find New Relic, enter your User API Key and region (US/EU). Optional: set a Default Account ID so tools don't require `accountId` on every call.
