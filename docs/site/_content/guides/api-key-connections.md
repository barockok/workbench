---
title: API-key connections
description: Connecting an integration that authenticates with a static key instead of OAuth, using New Relic as the worked example.
---

Some providers have no OAuth app worth registering — you paste a key and you are done.
For these, a plugin declares `auth.type: "apikey"` and the portal renders a form from
the manifest.

New Relic is the shipped example, and the only plugin currently using this auth type.

## The fields model

An `apikey` manifest declares a header name and a list of fields:

```ts
auth: {
  type: "apikey",
  headerName: "Api-Key",
  allowedHosts: ["api.newrelic.com", "api.eu.newrelic.com"],
  fields: [
    { key: "apiKey",    label: "New Relic User API Key", secret: true,
      placeholder: "Enter New Relic User API Key" },
    { key: "region",    label: "Account Region", options: ["US", "EU"], placeholder: "US" },
    { key: "accountId", label: "Default Account ID", optional: true, placeholder: "1234567" },
  ],
}
```

| Field property | Effect |
|---|---|
| `key` | The name the value is stored under |
| `label` | Shown in the portal form; also used in validation error messages |
| `description` | Help text under the input |
| `placeholder` | Input placeholder |
| `secret` | Marks the credential field. Declare exactly one — the server takes the **first** field with `secret: true` and drops every other one |
| `options` | Renders a `<select>`. A submitted value must be one of these; a blank value on an `optional` field skips the check |
| `optional` | May be left blank; every other field is required |

## Which field is the secret, and where the rest go

This is the split that matters:

- The **`secret: true`** field's value becomes the connection's access token, encrypted
  at rest with AES-256-GCM, exactly like an OAuth access token. It is the value injected
  into requests.
- **Every other non-blank field** is stored as the connection's `config` JSON, in
  plaintext. Tools read it with `ctx.getConfig()`.

So for New Relic: `apiKey` becomes the encrypted credential; `region` and `accountId`
become `{"region":"US","accountId":"1234567"}` in `config`. The region is what selects
the US or EU NerdGraph endpoint at request time, both for tools and for the
[curl proxy](curl-session.md).

A manifest with no `secret` field is a plugin bug — the connect endpoint returns 500.

## Connecting

API-key integrations connect **from the portal**, not from the agent. The `connect`
meta-tool has no apikey branch; calling it on one falls into the OAuth path and errors.

In the portal, clicking Connect on an apikey integration fetches its field list and
opens a modal. Submitting posts to:

```bash
curl -X POST https://workbench.example.com/api/auth/apikey/newrelic \
  -H "Authorization: Bearer $SESSION_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"values":{"apiKey":"NRAK-…","region":"US","accountId":"1234567"}}'
# {"success":true}
```

Validation, and the errors you can get back:

| Status | Body | Cause |
|---|---|---|
| 400 | `Missing required field: <label>` | A non-`optional` field was blank |
| 400 | `<label> must be one of: …` | A value not in that field's `options` |
| 404 | — | The integration is not apikey-auth |
| 500 | — | The manifest declares no `secret` field. Declaring *two* is not an error — the second is silently discarded |

Unlike OAuth, this is **synchronous**. There is no redirect, no pending record, and
nothing for `wait_for_connection` to poll — the response is the outcome. Once it returns
`{"success":true}`, `list_integrations` reports the integration as connected and tools
work immediately.

Disconnecting is the same as any other integration:
`DELETE /api/connections/newrelic`.

## How the header is set

When a tool or the curl proxy calls `ctx.http()`, the stored secret is written to the
manifest's `headerName` **verbatim**:

```
Api-Key: NRAK-…
```

No `Bearer` prefix is added, and no other transformation is applied. If a provider wants
`Authorization: Token abc123`, the manifest sets `headerName: "Authorization"` and the
user pastes `Token abc123` as the value — the scheme has to be baked into the value
itself. This is deliberate: API-key providers disagree about header schemes far too much
for the server to guess.

## allowedHosts pinning

An apikey manifest may declare `allowedHosts`. Before the credential is attached,
`ctx.http()` checks the target hostname against the list — it must equal an entry or be
a subdomain of one. A violation **throws before the header is set**, so the key is never
sent to an unlisted host.

New Relic pins to `api.newrelic.com` and `api.eu.newrelic.com`, which is why a
misconstructed URL in a tool cannot leak the key to a third party.

> [!WARNING] Without `allowedHosts` there is no host validation at all
> The check runs only when the manifest sets the list. Omit it, and `ctx.http()` will
> attach the user's API key to whatever URL the plugin passes — including one derived
> from tool arguments. If you are writing an apikey plugin, set `allowedHosts`, or
> validate the host in the handler before calling `ctx.http()`. The cookie auth branch
> enforces a host check unconditionally; the apikey branch does not.

## Reading config in a tool

`ctx.getConfig()` is synchronous and returns the stored config object, or `{}` when
nothing is stored:

```ts
handler: async (ctx: any, args: any) => {
  const region = String(ctx.getConfig().region ?? "US").toUpperCase();
  const endpoint = region === "EU"
    ? "https://api.eu.newrelic.com/graphql"
    : "https://api.newrelic.com/graphql";
  const res = await ctx.http(endpoint, { /* … */ });
  return res.json();
}
```

The same mechanism carries the instance URL for self-hosted OAuth integrations — see
[Self-hosted instances](self-hosted-instances.md).
