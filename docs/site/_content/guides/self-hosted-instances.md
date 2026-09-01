---
title: Self-hosted instances
description: Pointing an integration at your own GitLab (or any instance-aware provider) instead of the vendor's cloud.
---

Providers that ship an on-premises edition present the same API at a different origin.
GitLab is the shipped example: `gitlab.com` and `gitlab.example.com` speak the same
`/api/v4`, but they are separate deployments with separate accounts and separate OAuth
applications.

workbench handles this **per connection**. One user can connect to `gitlab.com` while
another connects to the company instance, against the same plugin, at the same time.

## Why one cloud OAuth app cannot authorize a self-hosted instance

This is the constraint everything else follows from.

An OAuth client id and secret are issued *by a specific authorization server*. The
credentials your GitLab.com application gives you are meaningless to
`gitlab.example.com` — it has never heard of that client id, has no record of the
redirect URI, and will reject the authorize request outright. There is no federation
between a vendor's cloud and a customer's own install.

So a self-hosted connection needs its own OAuth application, registered on that
instance, with the workbench's callback URL. What the workbench provides is the
plumbing: a way to say *which* instance a connection is for, and to send the whole
handshake there instead of to the cloud.

## Declaring it in a manifest

An `oauth2` manifest opts in with an `instance` block:

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
proxy: { resolver: "instance-url", pathPrefix: "/api/v4" },
```

| Key | Purpose |
|---|---|
| `label` | The prompt shown to the user at connect time |
| `placeholder` | Example value in the input |
| `default` | The vendor cloud origin — always allowed, and prefilled |

The `authorizationUrl` and `tokenUrl` stay written against the cloud. They are templates:
the server keeps their **paths** and swaps in the chosen origin.

## Connecting

In the portal, clicking Connect on an integration that declares `instance` prompts for
the origin, prefilled with the manifest default. Leaving it as-is connects to the cloud.
Entering `https://gitlab.example.com` connects to your instance.

The chosen origin is passed through as `?instanceUrl=` on the connect request, carried
through the handshake in `pending_auth`, and copied onto the connection when the
callback stores the token.

### What the origin must look like

The value is normalized before anything uses it, and the rules are strict:

| Rule | Rejected example |
|---|---|
| Must be `https` | `http://gitlab.example.com` |
| No userinfo in the URL | `https://user:pw@gitlab.example.com` |
| No private or loopback literals | `http://10.0.0.5`, `https://localhost`, `169.254.169.254` |
| Path, query and fragment are dropped | `https://gitlab.example.com/foo` → `https://gitlab.example.com` |

The private-address block is a literal check on the hostname — `127.*`, `10.*`,
`172.16–31.*`, `192.168.*`, `169.254.*` (which covers cloud metadata endpoints),
`0.*`, `localhost` and its subdomains, and the IPv6 loopback, ULA and link-local
prefixes. There is no DNS resolution, so a public name pointing at a private address is
not caught by this rule.

### Allow-listing the instance

An arbitrary origin is **not** accepted just because it normalizes cleanly. The manifest's
cloud default is always allowed. Any other origin must appear in a per-plugin
environment variable:

```bash
GITLAB_ALLOWED_INSTANCES=https://gitlab.example.com,https://gitlab.eu.example.com
```

The variable name is the plugin name, kebab-case converted to upper snake case, plus
`_ALLOWED_INSTANCES` — the same convention as `GITLAB_CLIENT_ID` and
`GITLAB_CLIENT_SECRET`. With the variable unset, **only the cloud default connects.**

This guard exists because the client secret is POSTed to whichever origin is chosen. An
unrestricted instance field would let any user of your workbench direct your shared
GitLab client secret to a host they control.

## The origin swap

Once an origin is chosen, three URLs are rewritten. Each keeps the manifest URL's path
and query and takes the new origin:

| Step | Cloud | Self-hosted |
|---|---|---|
| Authorize | `https://gitlab.com/oauth/authorize` | `https://gitlab.example.com/oauth/authorize` |
| Token exchange | `https://gitlab.com/oauth/token` | `https://gitlab.example.com/oauth/token` |
| Token refresh | `https://gitlab.com/oauth/token` | `https://gitlab.example.com/oauth/token` |

Refresh matters as much as the first two — a connection whose refresh went to the cloud
would break the first time the access token aged out.

The **callback URL is the workbench's own** and does not change:

```
<SERVER_PUBLIC_URL>/api/auth/plugin/gitlab/callback
```

Register exactly that as the redirect URI in the OAuth application you create on your
instance.

## Using it in tools

The origin is stored on the connection as `config` and read synchronously with
`ctx.getConfig()`:

```ts
function base(ctx: any): string {
  const instanceUrl = (ctx.getConfig().instanceUrl as string) || "https://gitlab.com";
  return `${instanceUrl.replace(/\/$/, "")}/api/v4`;
}
```

Every GitLab tool builds its URL this way, defaulting to the cloud when nothing is
stored. Two consequences worth knowing:

- The stored `config` is **not encrypted**. The instance origin is plaintext in the
  database, alongside the encrypted tokens.
- The instance origin survives a token refresh. The refresh path carries the existing
  `config` through into the record it re-stores, and the write also uses `COALESCE` as a
  second line of defence, so the origin is not nulled out either way.

## The curl proxy

`proxy: { resolver: "instance-url", pathPrefix: "/api/v4" }` makes the same origin drive
[`curl_session`](curl-session.md). A request to `/c/gitlab/projects` resolves to
`<instanceUrl>/api/v4/projects` for whoever's connection it is.

If the connection has no stored `instanceUrl`, the proxy fails with 502 and
`No instanceUrl in connection config for gitlab`. That means the connection predates the
instance support, or was created without going through the prompt — reconnect to fix it.

## Setup checklist

:::steps

### Create an OAuth application on your instance

In GitLab: **Admin** or **User Settings → Applications**. Redirect URI is
`<SERVER_PUBLIC_URL>/api/auth/plugin/gitlab/callback`. Scope: `api`.

### Configure the workbench

```bash
GITLAB_CLIENT_ID=<from your instance>
GITLAB_CLIENT_SECRET=<from your instance>
GITLAB_ALLOWED_INSTANCES=https://gitlab.example.com
```

Restart the server — the config schema is parsed at import time.

### Connect from the portal

Click Connect on GitLab, enter `https://gitlab.example.com` at the prompt, and complete
the consent screen on your instance.

### Verify

```json
{ "executions": [ { "tool": "gitlab_list_projects", "args": {} } ] }
```

The projects returned should be your instance's, not `gitlab.com`'s.

:::

> [!NOTE] One client id per workbench, not per instance
> `GITLAB_CLIENT_ID` is a single value. If you need to reach two different self-hosted
> instances that each issued you different credentials, one set of credentials has to be
> registered on both — or the second instance needs its own plugin. The allow-list
> supports multiple origins. The client credentials do not.
