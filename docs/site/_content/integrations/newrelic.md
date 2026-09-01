---
title: New Relic
description: Connect New Relic with a User API key so an agent can run NRQL, find entities, and manage dashboards and alerting.
---

New Relic is the one integration that does not use OAuth. The user pastes a User API key, picks a region, and optionally sets a default account id. Every tool then speaks NerdGraph, New Relic's GraphQL API. That covers NRQL queries, entity search, dashboard reads and widget writes, alert policies and conditions, notification destinations, and tagging.

## At a glance

| | |
|---|---|
| Plugin id | `newrelic` |
| Auth | API key |
| Tools | 13 |
| Header | `Api-Key` |
| Endpoint | `https://api.newrelic.com/graphql` (US) or `https://api.eu.newrelic.com/graphql` (EU) |
| Allowed hosts | `api.newrelic.com`, `api.eu.newrelic.com` |

The endpoint is chosen per request from the `region` value stored on the connection. There is nothing to register and no consent screen — an API-key connection is stored synchronously the moment the user submits the form.

## Create the API key

> [!NOTE] The console steps are New Relic's UI, not this server's
> Menu names, labels, and page URLs below come from New Relic's console and change
> without notice. If what you see differs, follow [New Relic's own documentation](https://docs.newrelic.com/).
> What this server needs is unchanged either way: a User API key, pasted into the
> connection fields below.

:::steps
### Generate a User API key

In New Relic, open the user menu → **API keys** → **Create a key** → key type **User**. Copy it. You cannot read it back later.

### Note your region

US accounts live on `api.newrelic.com`, EU accounts on `api.eu.newrelic.com`. Getting this wrong produces authentication failures against a key that is perfectly valid on the other region.

### Find your account id, if you want a default

The numeric account id appears in the New Relic URL and under account settings. It is optional — see the field table.
:::

There is no OAuth app, so there is no callback URL for this integration.

## Connection fields

The portal renders these from the manifest.

| Field | Required | Notes |
|---|---|---|
| `apiKey` | Yes | The User API key. Stored encrypted as the connection's token; never returned to an agent. |
| `region` | Yes | A select with options `US` and `EU`. Determines the NerdGraph endpoint. |
| `accountId` | No | Numeric default account id. A User API key can span several accounts, so leaving it blank forces each call to pass `accountId` explicitly. |

## Server configuration

None. API-key integrations have no client id or secret, so no environment variables are involved. The portal's Connect button is enabled for this integration on a stock install.

## Connect

Portal: Connections → **Connect** on the New Relic card → fill the three fields → submit. The connection is live immediately.

An agent cannot complete this flow itself. `connect` returns a URL only for OAuth and cookie integrations. It has no API-key branch. `connect("newrelic")` therefore falls through to the OAuth path and comes back as `{ error: "Integration newrelic is not oauth2" }`. Point the user at the portal and re-check `list_integrations` instead.

> [!NOTE] A failed `connect` leaves a pending record
> The server creates the pending record before it builds the OAuth URL, so the failed call leaves a stale `PENDING` row behind. The row is harmless and expires after `CONNECT_TTL_SECONDS`. Do not wait on its `connectionId`, because the error response carries none.

## Tools

| Tool | Purpose |
|---|---|
| `newrelic_run_nrql` | Run an arbitrary NRQL query and return the raw result rows |
| `newrelic_search_entities` | Find entities by name, domain, or type; returns GUIDs |
| `newrelic_get_dashboard` | Fetch a dashboard by GUID with its pages and widgets |
| `newrelic_add_widgets_to_dashboard_page` | Add visualization widgets to an existing dashboard page |
| `newrelic_add_tags_to_entity` | Add tags to an entity by GUID |
| `newrelic_create_alert_policy` | Create an alert policy with an incident preference |
| `newrelic_create_static_nrql_condition` | Add a static NRQL threshold condition to a policy |
| `newrelic_create_ai_notifications_destination` | Create a destination (Slack, Jira, email, webhook, …) |
| `newrelic_create_ai_notifications_channel` | Create a channel bound to a destination |
| `newrelic_create_ai_workflow` | Connect an issue filter to notification channels |
| `newrelic_create_alert_notification_channel` | Legacy notification channel — see the warning below |
| `newrelic_add_notification_channels_to_policy` | Legacy channel-to-policy binding — see the warning below |
| `newrelic_configure_cloud_integration` | Enable an AWS, Azure, or GCP integration on a linked cloud account |

## Notes and gotchas

> [!WARNING] The two legacy alert-channel tools are best-effort and untested
> `newrelic_create_alert_notification_channel` and `newrelic_add_notification_channels_to_policy` target New Relic's legacy alert-channel mutations, which New Relic has been retiring in favour of AI Notifications. They were written against the documented shapes but have not been verified end to end. For anything new, use the `newrelic_create_ai_notifications_*` and `newrelic_create_ai_workflow` tools instead.

The `Api-Key` header value is sent **verbatim** — the server adds no `Bearer` prefix and no other decoration. That is what NerdGraph expects, and it means the stored value must be exactly the key.

The key is pinned by `allowedHosts` to `api.newrelic.com` and `api.eu.newrelic.com`. A request to any other host throws before the credential is attached, so the key cannot leak to another destination. New Relic is the only shipped plugin that sets this. For API-key plugins in general, omitting `allowedHosts` means no host validation happens at all.

Everything is NerdGraph. There is no REST surface here, so `newrelic_run_nrql` is the tool for any read the specific tools do not cover.

Leaving `accountId` blank is the safer default when the key spans several accounts. Every call then has to name the account it means. Otherwise a call queries whichever account you configured months ago.
