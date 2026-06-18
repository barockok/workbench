# 2026-06-18 — API-key auth path + New Relic (NerdGraph) plugin

## What was added

`ApiKeyConfig` existed in `packages/shared/src/types.ts` from the start but **no
apikey auth path was ever wired** — `ctx.http`, the connect routes, and the
portal only handled `oauth2` / `cookie` / `none`. Adding New Relic (which
authenticates with a User API Key + a region, no OAuth) required building the
generic apikey flow end-to-end first, then dropping the plugin on top.

## The generic apikey flow

- **Manifest shape** (`ApiKeyConfig`): `headerName` (header the credential
  rides in) + `fields[]` (connect-time form spec). Exactly one field sets
  `secret: true` — that's the credential. Fields with `options[]` render as a
  `<select>`.
- **Storage** (`POST /api/auth/apikey/:integration`, routes.ts): the secret
  field → encrypted `accessToken`; every other field → per-connection `config`
  JSON. Reuses the existing `connections` row + `storeToken`. No `markConnected`
  — apikey connect is synchronous (no PENDING record); the stored token alone
  makes `/api/connections` report connected.
- **`ctx.http` apikey branch** (plugins/context.ts): sets
  `headers[headerName] = accessToken` **verbatim — no `Bearer` prefix** (New
  Relic wants a bare `Api-Key: <key>`). No token expiry/refresh. Bake any scheme
  into the field value if a future apikey integration needs one.
- **Tools read config** via `ctx.getConfig()[field.key]` (e.g. `region`), same
  mechanism self-hosted GitLab uses for `instanceUrl`.
- **Portal**: `GET /api/auth/:integration` returns `{ type: "apikey", fields }`;
  Dashboard opens `ApiKeyAuthModal` (renders the field spec) which POSTs the
  values back. `isConfigured` → always true (user supplies the key; no server
  creds needed).

## New Relic specifics

- **Everything is NerdGraph** — one GraphQL endpoint, region-scoped:
  US `https://api.newrelic.com/graphql`, EU `https://api.eu.newrelic.com/graphql`.
  The reference tool list had two "Create Alert Policy" entries (one labelled
  "(GraphQL)"); they collapse to a single `newrelic_create_alert_policy` since
  there is no non-GraphQL path.
- **Reads** (added after the create-only spec, since the plugin had no way to
  read anything back): `newrelic_run_nrql` (actor.account.nrql — the universal
  read), `newrelic_search_entities` (entitySearch; builds an ANDed query from
  name/domain/type, or takes a raw query — use it to find a dashboard/app GUID),
  `newrelic_get_dashboard` (actor.entity → DashboardEntity by GUID).
- **Confident mutations** (well-documented): `alertsPolicyCreate`,
  `alertsNrqlConditionStaticCreate`, `taggingAddTagsToEntity`,
  `dashboardAddWidgetsToPage`, `aiNotificationsCreateDestination`,
  `aiNotificationsCreateChannel`, `aiWorkflowsCreateWorkflow`,
  `cloudConfigureIntegration`.
- **Legacy / best-effort, UNTESTED against a live account**:
  `alertsNotificationChannelCreate` and `alertsNotificationChannelsAddToPolicy`.
  Legacy alert notification channels were historically a REST v2 surface; their
  NerdGraph mutation coverage is uncertain. New setups should prefer the AI
  Notifications destinations/channels/workflows. Verify these two against a real
  account before relying on them.
- Dashboard widget input is flattened in the tool (title / visualizationId /
  layout / nrqlQueries) and reassembled into NerdGraph's
  `visualization`/`layout`/`rawConfiguration` shape. Cloud-integration and
  AI-notification auth blocks are provider-shaped, so those args are
  passthrough objects (`z.record`).
