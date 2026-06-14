# GitLab — OAuth Credential Setup

Plugin: `packages/plugins/gitlab`
Auth type: OAuth 2.0 (Application, Authorization Code + PKCE)
Last verified against official docs: 2026-06-14

Scopes used (from `manifest.ts`):
`api`

Works with **both** gitlab.com (cloud) and **self-hosted** GitLab instances. The
user picks the instance at connect time (a "GitLab instance URL" prompt in the
portal, prefilled with `https://gitlab.com`). The chosen origin is stored on the
connection and used to build every API call and the OAuth authorize/token URLs.

---

## Cloud vs self-hosted — one OAuth app or many?

The OAuth endpoints are per-instance: `/<origin>/oauth/authorize` and
`/<origin>/oauth/token`. A single OAuth app on gitlab.com **cannot** authorize
users on a private instance and vice-versa — each GitLab instance has its own
application registry.

- **gitlab.com only:** create one application under your gitlab.com account/group.
- **A specific self-hosted instance:** create the application on that instance.
- **Several instances:** today the plugin uses one `GITLAB_CLIENT_ID` /
  `GITLAB_CLIENT_SECRET` pair, so all instances a deployment talks to must share
  a client id/secret (only practical when you control the instances, or for a
  single self-hosted target). For multiple unrelated instances, run separate
  deployments or extend `getPluginOAuthCreds` to key creds by instance.

## 1. Create the application

Cloud (per-user): https://gitlab.com/-/user_settings/applications
Group-owned (recommended for teams): Group → **Settings → Applications**
Self-hosted: same paths under your instance origin; instance-wide apps live in
**Admin → Applications**.

Fields:

| Field | Value |
|---|---|
| Name | `a-workbench` (or your deployment name) |
| Redirect URI | `https://<your-a-workbench-host>/api/auth/plugin/gitlab/callback` |
| Confidential | **on** (server keeps the secret) |
| Scopes | `api` |

> GitLab allows **multiple** redirect URIs (one per line) on a single app —
> unlike GitHub. Add your localhost dev callback
> (`http://localhost:3000/api/auth/plugin/gitlab/callback`) on the same app.

Click **Save application**. Copy the **Application ID** (client id) and **Secret**.

## 2. Wire into a-workbench

```bash
GITLAB_CLIENT_ID=<application id>
GITLAB_CLIENT_SECRET=<secret>
# Self-hosted only: allowlist the instance origin(s) users may connect to.
# Comma-separated, https origins. gitlab.com is always allowed without this.
GITLAB_ALLOWED_INSTANCES=https://gitlab.acme.com
```

The plugin loader reads these from `process.env` (`getPluginOAuthCreds` in
`packages/server/src/auth/plugin-oauth.ts`). The callback handler is generic.

> **Why the allowlist is required for self-hosted.** The instance origin a user
> enters at connect time receives the server's OAuth token POST — which carries
> your shared `GITLAB_CLIENT_SECRET`. Letting any authenticated user direct that
> at an arbitrary host would leak the secret (and enable SSRF). So a user-entered
> instance is rejected unless its origin is gitlab.com or listed in
> `GITLAB_ALLOWED_INSTANCES`. Origins must be **https** with no `user:pass@`, and
> private/loopback/link-local literals are blocked.

## 3. Scopes reference

| Scope | Grants |
|---|---|
| `api` | Full read/write: projects, repository files, issues, merge requests, pipelines, and git push over HTTPS. Needed for parity with the GitHub/Bitbucket plugins. |

Narrower alternatives if you only need reads: `read_api`, `read_repository`. Pushing
via `gitlab_get_clone_url` requires `write_repository` (covered by `api`).

## 4. Rate limits

- gitlab.com: per-endpoint limits, commonly **2,000 authenticated req/min** per user
  (varies by endpoint; search and raw blobs are tighter).
- Self-hosted: governed by the instance's **Admin → Settings → Network → Rate limits**.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `The redirect URI included is not valid` | Redirect URI mismatch (scheme/port/path). Add the exact callback to the app. |
| 401 on every call right after connecting | Wrong instance URL entered at connect time, or the app lives on a different instance than the one entered. |
| Global `gitlab_search_code` returns nothing on self-hosted | Blob (code) global search needs Advanced Search/Elasticsearch. Scope the search to a `project` instead. |
| `gitlab_approve_mr` 404 | MR approvals are a Premium/Ultimate feature; not available on that tier. |
| Token expired and no refresh | gitlab.com rotates refresh tokens; ensure the app is **Confidential** so a refresh token is issued. |

## References

- OAuth 2.0 provider — https://docs.gitlab.com/ee/api/oauth2.html
- REST API — https://docs.gitlab.com/ee/api/rest/
- Merge requests API — https://docs.gitlab.com/ee/api/merge_requests.html
- Scopes — https://docs.gitlab.com/ee/integration/oauth_provider.html#authorized-applications
