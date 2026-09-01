---
title: Manifest reference
description: Every field of the Integration interface that manifest.ts default-exports, required and optional, including the proxy block and self-hosted instance support.
---

`manifest.ts` default-exports a single object matching the `Integration`
interface. The loader imports it and hands it to `registry.register()` unchanged
— there is no validation step, so a typo in a field name is silent.

```ts
export interface Integration {
  name: string;
  version: string;
  auth: OAuthConfig | ApiKeyConfig | CookieConfig | NoneConfig;
  displayName?: string;
  description?: string;
  logo?: string;
  categories?: string[];
  proxy?: {
    baseUrl?: string;
    resolver?: "instance-url" | "newrelic-region";
    pathPrefix?: string;
  };
}
```

## Fields

| Field | Required | Default | What it does |
|---|---|---|---|
| `name` | Yes | — | Integration identity. Must equal the plugin's directory name. Drives the OAuth env-var prefix, the callback URL, and the registry key. |
| `version` | Yes | — | Free-form string. Every shipped plugin uses `"1.0.0"`. Surfaced by `list_integrations`. |
| `auth` | Yes | — | One of the four auth configs. See [auth modes](auth-modes.md). |
| `displayName` | No | `name` | Human label shown in the portal. |
| `description` | No | — | One line shown on the integration card and detail view. |
| `logo` | No | — | Bare filename in the plugin directory, or a full `https://` URL. |
| `categories` | No | — | Strings driving the portal's category filter, e.g. `["dev"]`, `["google","ai"]`. |
| `proxy` | No | — | Enables `curl_session` for this integration. See below. |

### `name`

The directory name **must** equal `name`. It is also the prefix the OAuth
credential resolver uses: kebab-case is uppercased with dashes turned into
underscores.

| Plugin name | Env vars |
|---|---|
| `google-gmail` | `GOOGLE_GMAIL_CLIENT_ID` / `GOOGLE_GMAIL_CLIENT_SECRET` |
| `atlassian-jira` | `ATLASSIAN_JIRA_CLIENT_ID` / `ATLASSIAN_JIRA_CLIENT_SECRET` |

And it is embedded in the redirect URI you register with the provider:

```
${SERVER_PUBLIC_URL}/api/auth/plugin/<name>/callback
```

Renaming the directory after registering the OAuth app breaks the callback.

### `logo`

Resolved two ways:

- **Bundled file** — a bare filename such as `"logo.svg"`, referencing a file in
  the same plugin directory. The server serves it at
  `GET /api/integrations/<name>/logo`, with the content type derived from the
  extension. Works identically for built-in and external plugins.
- **Remote URL** — a full `https://…` URL, passed through to the portal as-is.
  Simplest for an external plugin that would rather not ship a file.

Omitted or missing, the portal renders a generic cog mark and logs nothing.
`httpbin-cookie` ships without a logo deliberately, to exercise that fallback.

## `proxy` — enabling raw API calls

When `proxy` is set, the integration becomes eligible for the `curl_session`
meta-tool: an agent can mint a short-lived token and then issue arbitrary
requests to `/c/<name>/<path>`, with the user's stored credential injected by the
proxy. Without `proxy`, `curl_session` rejects the integration with
`curl proxy not enabled`.

Either `baseUrl` or `resolver` must be set.

| Field | Purpose |
|---|---|
| `baseUrl` | Static API base, e.g. `"https://api.github.com"`. |
| `resolver` | Dynamic base resolved server-side per request from the connection's config. One of `"instance-url"` or `"newrelic-region"`. |
| `pathPrefix` | Path suffix appended to a resolved instance URL. Used with `resolver: "instance-url"`. |

A static base is the common case:

```ts
proxy: { baseUrl: "https://api.github.com" },
```

A self-hosted integration resolves its base from the instance URL the user gave
at connect time, then appends the API path:

```ts
// gitlab
proxy: { resolver: "instance-url", pathPrefix: "/api/v4" },
```

New Relic resolves its base from the region stored on the connection:

```ts
// newrelic
proxy: { resolver: "newrelic-region" },
```

### The `cloud-id` placeholder

Atlassian API URLs embed a per-site cloud id that is only discoverable after the
user connects. Both the manifest and your tool code write the literal string
`cloud-id` in that position, and it is substituted at request time:

```ts
// atlassian-jira
proxy: { baseUrl: "https://api.atlassian.com/ex/jira/cloud-id" },

// atlassian-confluence
proxy: { baseUrl: "https://api.atlassian.com/ex/confluence/cloud-id/wiki" },
```

`ctx.http()` performs the same substitution for any URL matching
`https://api.atlassian.com/ex/(jira|confluence)/cloud-id/`, resolving the real id
from Atlassian's `accessible-resources` endpoint and caching it per user and
product. Details in the [context reference](context.md).

## The `auth` block

Four shapes, discriminated by `type`. The full field list, portal behaviour, and
worked examples for each are in [auth modes](auth-modes.md); this is the type
surface.

```ts
export interface OAuthConfig {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  instance?: { label: string; placeholder?: string; default: string };
}

export interface ApiKeyConfig {
  type: "apikey";
  headerName: string;
  fields: ApiKeyField[];
  allowedHosts?: string[];
}

export interface CookieConfig {
  type: "cookie";
  loginUrl: string;
  targetDomain: string;
  cookieDomains?: string[];
}

export interface NoneConfig { type: "none"; }
```

### `auth.instance` — self-hosted deployments

Set `instance` on an `oauth2` config when the same product runs at customer-chosen
origins — a private GitLab, for example. The portal then asks for an instance URL
at connect time.

```ts
export interface OAuthConfig {
  // …
  instance?: {
    // Portal field label, e.g. "GitLab instance URL".
    label: string;
    // Placeholder shown in the portal input, e.g. "https://gitlab.example.com".
    placeholder?: string;
    // Prefilled default origin, e.g. "https://gitlab.com" (the cloud host).
    default: string;
  };
}
```

The portal renders this as a native `window.prompt`: `label` is the prompt text
and `default` is prefilled as the initial value. `placeholder` is declared on the
type and sent to the client, but nothing in the portal consumes it — a
`window.prompt` has no placeholder. Blank input falls back to `default`.

`authorizationUrl` and `tokenUrl` act as the **cloud default**. For a custom
instance the server keeps their *paths* and swaps in the user's origin — so
`https://gitlab.com/oauth/authorize` becomes
`https://gitlab.acme.com/oauth/authorize`. The chosen origin is persisted on the
connection and read back by tools as `ctx.getConfig().instanceUrl`.

The GitLab manifest is the shipped example:

```ts
auth: {
  type: "oauth2",
  authorizationUrl: "https://gitlab.com/oauth/authorize",
  tokenUrl: "https://gitlab.com/oauth/token",
  scopes: ["api"],
  instance: {
    label: "GitLab instance URL",
    placeholder: "https://gitlab.example.com",
    default: "https://gitlab.com",
  },
},
```

Every GitLab tool builds its API base from that config, falling back to
`https://gitlab.com`:

```ts
function origin(ctx: any): string {
  const u = ctx.getConfig?.()?.instanceUrl;
  return typeof u === "string" && u ? u.replace(/\/+$/, "") : DEFAULT_ORIGIN;
}
```

Omit the `instance` block entirely for cloud-only integrations.

> [!WARNING] The Zod `integrationSchema` is stale and unused
> `packages/shared/src/schemas.ts` exports an `integrationSchema` that predates
> both `proxy` and the OAuth `instance` block, and validates neither. It is not
> called anywhere in the load path — the loader imports your manifest and
> registers it without validation. Treat the TypeScript `Integration` interface
> as the contract, not that schema.
