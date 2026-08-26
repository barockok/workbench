# Atlassian Confluence — OAuth Credential Setup

Plugin: `packages/plugins/atlassian-confluence`
Auth type: OAuth 2.0 (3LO — three-legged)
Last verified against official docs: 2026-08-19

Scopes used (from `manifest.ts`) — **granular**, not classic:
`read:page:confluence`, `write:page:confluence`, `delete:page:confluence`, `read:space:confluence`, `read:attachment:confluence`, `search:confluence`, `offline_access`

---

## Setup is identical to Jira's flow

Confluence and Jira share the same Atlassian developer console, the same auth endpoints (`auth.atlassian.com`), and the same `cloudid` resolution pattern. Follow [atlassian-jira.md](./atlassian-jira.md) for the full step-by-step, then below are the **Confluence-specific differences**.

### Permissions → Confluence API

Add the **Confluence API** (not Jira) and configure these scopes:

| Scope | Grants | Needed for |
|---|---|---|
| `read:page:confluence` | Read pages, incl. storage-format body | `confluence_get_page`, `confluence_search_pages` |
| `write:page:confluence` | Create and update pages | `confluence_create_page`, `confluence_update_page` |
| `delete:page:confluence` | Delete pages | `confluence_delete_page` |
| `read:space:confluence` | Read space metadata (id, key, name) | `confluence_list_spaces`, and the internal spaceKey↔spaceId resolver every page tool uses |
| `read:attachment:confluence` | List a page's attachments | the `attachments` array on `confluence_get_page` |
| `search:confluence` | CQL search across content | `confluence_search_pages` |
| `offline_access` | Issue a refresh token | keeping the connection alive past ~1h |

### Granular scopes only — do not mix in classic ones

Confluence's v2 REST API (`/wiki/api/v2/pages`, `/wiki/api/v2/spaces`) requires **granular** scopes. The classic `read:confluence-content.summary` family only authorizes the **v1 content API, which Atlassian removed** — see [the v1 removal finding](../findings/2026-06-12-confluence-v1-content-get-removed.md) and [the v2 migration](../findings/2026-06-22-confluence-v2-migration.md). This plugin is fully on v2 + granular.

In the developer console the granular checkboxes live under a **Granular scopes** tab in *Edit Confluence API*, and they are **disabled while any classic scope is selected** — a 3LO app cannot hold both models at once. Untick every classic row first.

Only `confluence_search_pages` still calls a v1 path: `/wiki/rest/api/search` (CQL). That endpoint is not part of the removal and needs `search:confluence`, which is itself granular.

**Changing this scope list forces every existing user to reconnect.** Refresh does not re-request scopes, so an old token keeps working with whatever it was minted for — it just silently lacks the new capability (a token from before `read:attachment:confluence` gets a page with the `attachments` field omitted, not an error).

### Callback URL

```
https://<your-a-workbench-host>/api/auth/atlassian-confluence/callback
```

### Cloud ID endpoint differs

Confluence API base after resolving `cloudid` — note the `/wiki/` prefix Confluence requires:
```
https://api.atlassian.com/ex/confluence/<cloudid>/wiki/api/v2/...
```
Everything except search runs on v2. Search alone stays on the v1 CQL path:
```
https://api.atlassian.com/ex/confluence/<cloudid>/wiki/rest/api/search
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
