# Atlassian Confluence — OAuth Credential Setup

Plugin: `packages/plugins/atlassian-confluence`
Auth type: OAuth 2.0 (3LO — three-legged)
Last verified against official docs: 2026-05-27

Scopes used (from `manifest.ts`):
`read:confluence-content.summary`, `write:confluence-content`, `search:confluence`

---

## Setup is identical to Jira's flow

Confluence and Jira share the same Atlassian developer console, the same auth endpoints (`auth.atlassian.com`), and the same `cloudid` resolution pattern. Follow [atlassian-jira.md](./atlassian-jira.md) for the full step-by-step, then below are the **Confluence-specific differences**.

### Permissions → Confluence API

Add the **Confluence API** (not Jira) and configure these scopes:

| Scope | Grants |
|---|---|
| `read:confluence-content.summary` | Read page summaries (title, IDs, metadata) without rendered body |
| `write:confluence-content` | Create, update, delete pages and content |
| `search:confluence` | CQL search across content |

> Sensitive scopes (`read:confluence-content.all` for full body, attachments) require additional review for distribution. Stay on `.summary` unless you really need rendered HTML.

### Callback URL

```
https://<your-a-workbench-host>/api/auth/atlassian-confluence/callback
```

### Cloud ID endpoint differs

Confluence API base after resolving `cloudid`:
```
https://api.atlassian.com/ex/confluence/<cloudid>/wiki/rest/api/...
```
(Note the `/wiki/` prefix that Confluence requires.)

For the newer Confluence v2 REST API:
```
https://api.atlassian.com/ex/confluence/<cloudid>/wiki/api/v2/...
```
The plugin auto-resolves cloudid via `/oauth/token/accessible-resources` — same as Jira.

### Credentials

If you created a separate Atlassian app for Confluence (recommended for least-privilege):
```bash
ATLASSIAN_CONFLUENCE_CLIENT_ID=...
ATLASSIAN_CONFLUENCE_CLIENT_SECRET=...
```

Otherwise share one Atlassian app with Jira — add both products under **Permissions** and add both products' scopes — and use a unified `ATLASSIAN_CLIENT_ID/SECRET`.

## References

- Confluence Cloud OAuth scopes — https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/
- Confluence Cloud REST API v2 — https://developer.atlassian.com/cloud/confluence/rest/v2/intro/
- OAuth 2.0 (3LO) — https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
