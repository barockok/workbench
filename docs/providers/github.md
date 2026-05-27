# GitHub — OAuth Credential Setup

Plugin: `packages/plugins/github`
Auth type: OAuth 2.0 (OAuth App, user-to-server)
Last verified against official docs: 2026-05-27

Scopes used (from `manifest.ts`):
`repo`, `read:user`, `read:org`, `issues`, `pull_requests`

---

## OAuth App vs GitHub App

GitHub offers two app models. a-workbench uses **OAuth App** (simpler, user-scoped, classic scopes). GitHub Apps offer finer permissions and shorter-lived tokens but require a different flow — not used here.

- OAuth App: one callback URL, classic scope strings, never expires unless revoked.
- GitHub App: multiple callbacks, fine-grained permissions, 8-hour user tokens, installation tokens.

If you need org-level installation control, switch to GitHub App and update the plugin.

## 1. Create the OAuth App

Personal account:
1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**

Organization (recommended for team use):
1. https://github.com/organizations/<ORG>/settings/applications → **OAuth Apps** → **New OAuth App**

Fields:

| Field | Value |
|---|---|
| Application name | `a-workbench` (or your deployment name) |
| Homepage URL | `https://<your-a-workbench-host>` |
| Authorization callback URL | `https://<your-a-workbench-host>/api/auth/github/callback` |
| Enable Device Flow | leave off |

Click **Register application**.

> OAuth Apps support **only one** callback URL. For local dev create a second OAuth App with `http://localhost:3000/api/auth/github/callback`.

## 2. Generate the client secret

On the app page:
1. **Client ID** is shown at the top — copy it.
2. **Generate a new client secret** → copy immediately (shown once).

## 3. Wire into a-workbench

Until per-plugin OAuth credential storage lands, set as env vars (naming convention — match what the plugin loader expects):

```bash
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=ghp_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 4. Scopes reference

| Scope | Grants |
|---|---|
| `repo` | Full control of private repos (read/write code, commit statuses, deployments, invitations) |
| `read:user` | Read profile data |
| `read:org` | Read org membership, teams |
| `issues` | (not a standard top-level OAuth scope — issues are covered by `repo`; kept here if your manifest uses a fine-grained variant) |
| `pull_requests` | (same — covered by `repo` for OAuth Apps) |

> Heads-up: classic OAuth scopes don't actually have separate `issues` / `pull_requests` entries — `repo` covers both. If you switch to GitHub App fine-grained permissions, those become real distinct permissions. Audit `manifest.ts` against https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps before relying on them.

## 5. Rate limits

- OAuth user-to-server: **5,000 req/hour per user**.
- Secondary rate limits apply to abusive patterns (rapid creation of issues/PRs).
- GitHub Apps installation tokens get 5,000/hour per installation + scaling for large orgs — another reason to consider upgrading.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri MUST match the registered callback URL` | URL mismatch — including scheme, port, path |
| `bad_verification_code` | State expired (10 min TTL) or code already redeemed |
| 404 on private repo access | User did not grant `repo` scope, or SSO-enforced org requires per-token SSO authorization (org SAML) |
| 403 `Resource protected by organization SAML enforcement` | User must visit https://github.com/orgs/<ORG>/sso to authorize the token |

## References

- Creating an OAuth App — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- OAuth web app flow — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Scopes for OAuth Apps — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- Differences OAuth vs GitHub Apps — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
