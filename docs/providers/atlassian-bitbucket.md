# Bitbucket Cloud — OAuth Credential Setup

Plugin: `packages/plugins/atlassian-bitbucket`
Auth type: OAuth 2.0 (Workspace OAuth consumer)
Last verified against official docs: 2026-05-27

Scopes used (from `manifest.ts`):
`repository`, `pullrequest:write`, `account`

---

> Bitbucket Cloud's OAuth is **separate from** Atlassian developer console 3LO used by Jira/Confluence. You create a "consumer" inside each Bitbucket workspace's settings.

## 1. Create the OAuth consumer

1. Go to https://bitbucket.org/<workspace>/workspace/settings/api
   (or: Workspace settings → **Apps and features** → **OAuth consumers**)
2. **Add consumer**

| Field | Value |
|---|---|
| Name | `a-workbench` |
| Description | optional |
| Callback URL | `https://<your-a-workbench-host>/api/auth/atlassian-bitbucket/callback` |
| URL | your homepage (optional) |
| This is a private consumer | check if you'll use client credentials grant; leave unchecked for normal 3-legged flow |

### Permissions checklist

| Scope | Grants |
|---|---|
| `account` | Read account info (`/2.0/user`) |
| `repository` | Read repositories (incl. private ones the user can see) |
| `repository:write` | (if you need push/commit edits — not in current manifest) |
| `pullrequest` | Read PRs |
| `pullrequest:write` | Create/comment/merge PRs |

> Bitbucket's checkboxes are nested — picking `pullrequest:write` auto-selects `pullrequest`. Same for `repository:write` → `repository`.

**Save**.

## 2. Grab credentials

Back in **OAuth consumers**, expand your new consumer to reveal:

- **Key** (the `client_id`)
- **Secret** (the `client_secret`)

```bash
ATLASSIAN_BITBUCKET_CLIENT_ID=...
ATLASSIAN_BITBUCKET_CLIENT_SECRET=...
```

## 3. Auth flow notes

- Authorization URL: `https://bitbucket.org/site/oauth2/authorize`
- Token URL: `https://bitbucket.org/site/oauth2/access_token`
- Access tokens expire after **2 hours**. Refresh tokens are long-lived but rotate — store the new one returned on each refresh.
- The classic **Resource Owner Password Credentials** grant is no longer supported. Stick to Authorization Code.

## 4. Per-workspace vs per-user scoping

Bitbucket consumers are **workspace-scoped**. A consumer created in workspace A can be authorized by any Bitbucket user, but the consumer record itself lives in workspace A's settings. For multi-tenant a-workbench installs you may want a consumer in each customer workspace, or a single one in your own workspace that users grant access to. The default plugin assumes the single-consumer model.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_redirect_uri` | Callback URL mismatch (Bitbucket allows only one) |
| `unauthorized_client` | Wrong Key/Secret, or consumer was deleted/regenerated |
| 401 after 2h idle | Access token expired — refresh using the refresh token |
| 403 on a private repo | User lacks repo access in Bitbucket itself, or `repository` scope not granted |
| `Bitbucket Cloud Premium required` | Some org-policy features (IP allowlist, deployment permissions) require paid plan |

## References

- Use OAuth on Bitbucket Cloud — https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/
- Scopes — https://support.atlassian.com/bitbucket-cloud/docs/scope-attributes-and-restrictions/
- REST API docs — https://developer.atlassian.com/cloud/bitbucket/rest/intro/
