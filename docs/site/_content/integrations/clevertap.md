---
title: CleverTap
description: Connect CleverTap so an agent can query profiles, events, campaigns, and real-time counts across multiple projects (read-only).
---

CleverTap is a mobile analytics and engagement platform — profiles, events, campaigns, and reports. This plugin is **read-only** and **multi-project**: one connection holds a JSON array of projects, each with its own Account ID, Passcode, and region. Every tool takes an optional `project` name to target a specific project, defaulting to the first.

## At a glance

| | |
|---|---|
| Plugin id | `clevertap` |
| Auth | API key (JSON array, encrypted at rest) |
| Tools | 19 |
| Headers | `X-CleverTap-Account-Id`, `X-CleverTap-Passcode` |
| Endpoint | `https://{region}.api.clevertap.com/1` |
| Regions | `in1`, `us1`, `eu1`, `sg1`, `aps3`, `mec1` |
| Allowed hosts | `clevertap.com` |

Region picks the base URL per project. A request validates the host ends with `.clevertap.com` before attaching credentials.

## Find your credentials

> [!NOTE] The console steps are CleverTap's UI, not this server's
> Menu names and labels below come from CleverTap's dashboard and change
> without notice. If what you see differs, follow [CleverTap's own documentation](https://developer.clevertap.com/docs). What this server needs is unchanged: Account ID, Passcode, and region.

:::steps
### Open Project Settings

In CleverTap dashboard: **Settings → Project** (or **Settings → API Keys** depending on UI version). Each project shows its **Account ID** (e.g. `XXX-XXX-XXXX`) and **Passcode** (e.g. `YYY-YYY-YYYY`).

### Note your region

The data-center code appears in your CleverTap URL or dashboard settings. Common values: `in1` (India), `us1` (US), `eu1` (EU), `sg1` (Singapore), `aps3` (AP Southeast), `mec1` (Middle East). Getting this wrong points at the wrong host (`{region}.api.clevertap.com`) and returns auth errors.

### Repeat for each project

For multi-project, collect one triple per environment (prod, staging, …). Single-project also uses the same JSON array with one entry.
:::

There is no OAuth app and no callback URL for this integration.

## Connection fields

The portal renders these from the manifest.

| Field | Required | Notes |
|---|---|---|
| `projectsJson` | Yes | JSON array of projects. Multiline textarea, stored encrypted as the connection's token. Each entry: `{ name, accountId, passcode, region }`. Region must be one of `in1/us1/eu1/sg1/aps3/mec1`. Single-project: `[{"name":"prod","accountId":"XXX","passcode":"YYY","region":"us1"}]`. Also settable via `clevertap_set_projects` MCP tool. |

Example:

```json
[
  {
    "name": "production",
    "accountId": "XXX-XXX-XXXX",
    "passcode": "YYY-YYY-YYYY",
    "region": "us1"
  },
  {
    "name": "staging",
    "accountId": "AAA-AAA-AAAA",
    "passcode": "BBB-BBB-BBBB",
    "region": "eu1"
  }
]
```

## Server configuration

None. API-key integrations have no client id or secret, so no environment variables are involved. The portal's Connect button is enabled for this integration on a stock install.

## Connect

Portal: Connections → **Connect** on the CleverTap card → paste the `projectsJson` array → submit. The connection is live immediately.

Agent alternative — an already-connected user can overwrite via MCP:

```
clevertap_set_projects({ projects: [{ name: "prod", accountId: "...", passcode: "...", region: "us1" }] })
# or raw JSON string
clevertap_set_projects({ projectsJson: '[{"name":"prod","accountId":"XXX","passcode":"YYY","region":"us1"}]' })
clevertap_list_projects()
```

An agent cannot complete the portal form itself. `connect` returns a URL only for OAuth and cookie integrations. For API-key plugins, point the user at the portal and re-check `list_integrations` instead.

## Tools

| Tool | Purpose |
|---|---|
| `clevertap_list_projects` | List configured projects (name, accountId, region) + hint to pass `project` |
| `clevertap_set_projects` | Overwrite all projects via `projects` array or `projectsJson` string (local store only) |
| `clevertap_get_events` | Query event data for `event_name` in `from`..`to` (supports `groups`); returns cursor |
| `clevertap_get_events_cursor` | Next page via cursor from `clevertap_get_events` |
| `clevertap_get_event_count` | Count users who performed an event in range; optional `event_properties` filter; auto-polls `partial` |
| `clevertap_get_profile` | One profile by `identity`, `email`, or `objectId` (CleverTap GUID); at least one required |
| `clevertap_get_profiles_by_event` | Profiles of users who did `event_name` in range; returns cursor |
| `clevertap_get_profiles_cursor` | Next page via cursor from `clevertap_get_profiles_by_event` |
| `clevertap_get_profile_count` | Count profiles for event in range; optional `event_properties`; auto-polls |
| `clevertap_get_campaigns` | List campaigns (id, name, scheduled_on, status) in range |
| `clevertap_get_campaign_report` | Delivery/engagement report for campaign `id` |
| `clevertap_get_message_report` | Delivery/engagement by `channel`/`delivery`/`status`/`label` in range; optional `daily` |
| `clevertap_get_top_property_count` | Top property values for event (e.g. top product categories); auto-polls |
| `clevertap_get_event_trend` | Daily/weekly/monthly trend; `unique` and `sum_event_prop` options; auto-polls |
| `clevertap_get_dau` | DAU trend (unique `App Launched`) in range |
| `clevertap_get_uninstall_report` | Uninstall trend (unique `Uninstalled`) in range |
| `clevertap_get_real_time_counts` | Users active in last 5 minutes; optional `user_type` breakdown |
| `clevertap_request` | Any read request: `path`, `method` (GET/POST/DELETE), `body`, `params`, `poll`; 405 fallback; full CQL |
| `clevertap_poll` | Poll async `partial` result via `req_id` until success/fail |

Every tool except the two project helpers accepts optional `project: "<name>"`. Omit it to use the first configured project.

## Dates — strict YYYYMMDD

CleverTap's API 500s on `YYYY-MM-DD`. All `from`/`to` params are strict **8-digit `YYYYMMDD` without dashes** (e.g. `20260617`). The plugin normalizes for you: `2026-06-17` and `2026/06/17` are accepted and coerced to `20260617`, with an actionable error if the shape is wrong (`Remove dashes/slashes`). The description on each date param spells this out.

## CQL, system events, and profile props

Tool descriptions embed the three references so `search_tools` surfaces them without a docs round-trip:

- **System events:** `App Installed`, `App Launched`, `App Uninstalled`, `UTM Visited`, `Notification Sent/Viewed/Clicked`, `Charged`, … and system props like `CT App version`, `CT Latitude` (`@CT`). See [CleverTap Events](https://developer.clevertap.com/docs/events#system-events) and [System Properties](https://developer.clevertap.com/docs/events#system-properties).
- **Predefined profile props:** `Name`, `Identity`, `Email`, `Phone`, `Gender`, `DOB`, `Photo`, `MSG-email`, `MSG-push`, `MSG-sms`, `MSG-whatsapp`. See [User Profiles](https://developer.clevertap.com/docs/concepts-user-profiles#manually-updating-predefined-user-profile-properties).
- **CQL:** `event_properties`, `session_properties`, `common_profile_properties` (`app_fields`, `profile_fields`, `demographics`, `technographics`, `reachability`, `geo_fields`), `advanced_query` (`did_none`/`did_all`/`did_any`), `likelihood`. See [CQL](https://developer.clevertap.com/docs/clevertap-query-language). Use `clevertap_request` for full JSON.

## Notes and gotchas

> [!WARNING] Bare `fetch` by design
> The token is a JSON array of projects (`[{name, accountId, passcode, region}]`), not a single string. The server's generic `ctx.http` path injects one header (`headerName`) from `getToken()` — that would send the whole JSON as `X-CleverTap-Account-Id`. The plugin therefore uses bare `fetch` with `X-CleverTap-Account-Id` + `X-CleverTap-Passcode` per project. `allowedHosts: ["clevertap.com"]` plus a runtime `host.endsWith(".clevertap.com")` check still guard the credential.

Async polling: counts/trends (`counts/events.json`, `counts/profiles.json`, `counts/top.json`, `counts/trends.json`) can return `{ status: "partial", req_id }`. The plugin polls `GET {path}?req_id=...` up to 15×3s via `postWithPolling` (and `clevertap_poll` for the generic path). `clevertap_request` with `poll: true` does the same for arbitrary paths.

`clevertap_request` retries a 405 by swapping GET↔POST once and annotates the result with `_note`. For fully custom CQL JSON, prefer this tool and set `poll: true` when you expect `partial`.

Legacy single-project compat: if `getToken()` is not a JSON array, the plugin falls back to `passcode` as token + `accountId`/`region`/`projectName` from `getConfig()`. New installs should use the JSON array.

Read-only: the plugin exposes no profile ingest, event upload, or campaign-send writes. `clevertap_request` also restricts to read paths — there is no write surface here.

