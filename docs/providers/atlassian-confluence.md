# Atlassian Confluence — OAuth Credential Setup

Plugin: `packages/plugins/atlassian-confluence`
Auth type: OAuth 2.0 (3LO — three-legged)
Last verified against official docs: 2026-05-29

Scopes used (from `manifest.ts`):
`read:confluence-content.summary`, `write:confluence-content`, `search:confluence`, `read:confluence-space.summary`

---

## Setup is identical to Jira's flow

Confluence and Jira share the same Atlassian developer console, the same auth endpoints (`auth.atlassian.com`), and the same `cloudid` resolution pattern. Follow [atlassian-jira.md](./atlassian-jira.md) for the full step-by-step, then below are the **Confluence-specific differences**.

### Permissions → Confluence API

Add the **Confluence API** (not Jira) and configure these scopes:

| Scope | Grants | Needed for |
|---|---|---|
| `read:confluence-content.summary` | Read page summaries (title, IDs, metadata) without rendered body | `confluence_get_page`, `confluence_search_pages` |
| `write:confluence-content` | Create, update, delete pages and content | `confluence_create_page`, `confluence_update_page`, `confluence_delete_page` |
| `search:confluence` | CQL search across content | `confluence_search_pages`, `confluence_list_spaces` (via CQL fallback — see below) |
| `read:confluence-space.summary` | Read space metadata (key, name, type) | future-proofing; granted on the app, even though the plugin currently lists spaces via CQL |

> Sensitive scopes (`read:confluence-content.all` for full body, attachments) require additional review for distribution. Stay on `.summary` unless you really need rendered HTML.

### Classic vs granular scopes (and why `list_spaces` doesn't use Confluence v2)

Confluence's v2 REST API (`/wiki/api/v2/spaces`, `/wiki/api/v2/pages`, …) requires **granular scopes** such as `read:space:confluence`. The developer console exposes those under a **Granular scopes** tab in *Edit Confluence API*, but the checkboxes are **disabled while any classic scope is selected** — an OAuth 2.0 (3LO) app cannot mix classic and granular at the same time.

This plugin is on classic scopes. To get a list of spaces without switching the entire scope model:

- `confluence_list_spaces` does **not** call `/wiki/api/v2/spaces`.
- It calls `/wiki/rest/api/search?cql=type=space`, which only needs `search:confluence` (already granted). Response is the standard CQL `results[]` envelope; each hit carries a `space` object with `key`, `name`, `type`, `_links.self`.

If you ever decide to flip the app to granular scopes:
1. In Atlassian developer console → Permissions → Confluence API → *Edit Scopes* → **Granular scopes** tab, untick every classic row first, then tick the granular equivalents (`read:page:confluence`, `read:space:confluence`, `write:page:confluence`, etc.).
2. Update `manifest.ts` to request the granular scope names.
3. Update every confluence plugin tool to call `/wiki/api/v2/...` endpoints (currently the tools call `/wiki/rest/api/...`).
4. Clear stored tokens; users must re-consent.

That's a coordinated swap, not a partial edit — don't half-do it.

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
(v2 requires granular scopes — see the classic vs granular section above. The current plugin uses v1 endpoints throughout.)

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
