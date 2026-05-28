# Atlassian Jira — OAuth Credential Setup

Plugin: `packages/plugins/atlassian-jira`
Auth type: OAuth 2.0 (3LO — three-legged)
Last verified against official docs: 2026-05-29

Scopes used (from `manifest.ts`):
`read:jira-work`, `write:jira-work`, `read:me`, `read:jira-user`

---

## Background

Atlassian Cloud uses one OAuth 2.0 (3LO) app per integration that can request scopes across multiple Atlassian products (Jira, Confluence, Bitbucket via separate flow). One app can hold Jira *and* Confluence scopes if you want to share credentials — see [atlassian-confluence.md](./atlassian-confluence.md) for the matching Confluence scopes.

Auth endpoint: `https://auth.atlassian.com/authorize` (requires `audience=api.atlassian.com`)
Token endpoint: `https://auth.atlassian.com/oauth/token`

## 1. Create the OAuth 2.0 (3LO) app

1. Open https://developer.atlassian.com/console/myapps/
2. **Create** → **OAuth 2.0 integration**
3. Name: `a-workbench` (or similar), accept terms, **Create**

## 2. Add APIs and scopes

Left menu → **Permissions** → next to **Jira API** click **Add**, then **Configure**.

Add classic scopes:

| Scope | Grants | Needed for |
|---|---|---|
| `read:jira-work` | Read issues, projects, comments, attachments | `jira_project_types`, `jira_search_issues`, `jira_get_issue` |
| `write:jira-work` | Create/edit/transition issues, post comments | `jira_create_issue` |
| `read:me` | Read the authenticated user's account info | callback (identifies the user) |
| `read:jira-user` | View user profiles (username, email, avatar) in Jira | `jira_search_users` |

> Atlassian also offers **granular scopes** (e.g. `read:issue:jira`, `write:issue:jira`). The plugin currently uses classic scopes — keep them consistent with `manifest.ts`. If you switch to granular, update the manifest and re-consent. An OAuth 2.0 (3LO) app cannot mix classic and granular scopes — the developer console disables the granular checkboxes while any classic scope is selected.

### Boards / Jira Software

`jira_get_boards` calls `/rest/agile/1.0/board`, which sits under the **Jira Software API** and needs `read:board-scope:jira-software`. That API is **not offered** on the Permissions page of a standard OAuth 2.0 (3LO) app in `developer.atlassian.com/console/myapps/` — the only API rows there are Personal data reporting, User identity, Confluence, Jira platform REST, Compass GraphQL, and BRIE. Until Atlassian exposes Jira Software as an addable API on 3LO apps (or you migrate to a Forge / Connect app), `jira_get_boards` will return `Unauthorized; scope does not match`.

## 3. Configure Authorization (callback URL)

Left menu → **Authorization** → **Configure** next to OAuth 2.0 (3LO).

Callback URL:
```
https://<your-a-workbench-host>/api/auth/atlassian-jira/callback
```
Local dev — Atlassian allows `http://localhost`:
```
http://localhost:3000/api/auth/atlassian-jira/callback
```
Save.

## 4. Grab credentials

Left menu → **Settings** → scroll to **Authentication details**:

- **Client ID**
- **Secret** (click to reveal)

```bash
ATLASSIAN_JIRA_CLIENT_ID=...
ATLASSIAN_JIRA_CLIENT_SECRET=...
```

If sharing one Atlassian app for Jira + Confluence, use a single `ATLASSIAN_CLIENT_ID/SECRET` pair and point both plugin manifests at it (planned).

## 5. Distribution

Apps default to **Development** status — only you can install. To let others install:
1. **Distribution** → switch to **Sharing**
2. Fill in Privacy Policy URL (required)
3. Save.

## 6. Resource (Cloud) ID — important

3LO tokens are not directly usable against `https://<site>.atlassian.net/...`. After token exchange the plugin must call:
```
GET https://api.atlassian.com/oauth/token/accessible-resources
Authorization: Bearer <access_token>
```
to discover the user's `cloudid` and then call:
```
https://api.atlassian.com/ex/jira/<cloudid>/rest/api/3/...
```
Plugin handles this automatically — no setup needed, just be aware when debugging.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_redirect_uri` | Callback URL not registered exactly (Atlassian is strict on scheme + path) |
| `invalid_scope` | Scope not added under Permissions → Jira API. Granular vs classic mismatch is a common cause. |
| `Unauthorized; scope does not match` | App is missing the scope — toggle it under Permissions → Jira API and re-consent. For `read:board-scope:jira-software` this is the Atlassian-app-type limit noted above; not fixable in this app. |
| `The requested API has been removed` on `/rest/api/3/search` | You're on a pre-CHANGE-2046 plugin build — pull the latest, which uses `/rest/api/3/search/jql`. |
| 401 with valid token | Forgot to resolve `cloudid` and called `<site>.atlassian.net` directly |
| 403 `OAUTH_2_FORBIDDEN` | User lacks the requested permission in Jira itself (project/issue restrictions) |
| Refresh fails after long idle | Atlassian refresh tokens rotate — store the new `refresh_token` returned on each refresh call |

## References

- OAuth 2.0 (3LO) overview — https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Jira Cloud Platform scopes — https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Granular scopes — https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/#granular-scopes
- Accessible resources API — https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/#3--make-calls-to-the-api-using-the-access-token
