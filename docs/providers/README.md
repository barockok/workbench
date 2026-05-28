# Provider Credential Setup Guides

One markdown per supported integration, with current official steps to obtain OAuth credentials. Verified against vendor documentation on the date noted in each file.

## Supported providers

| Provider | Plugin | Auth | Doc |
|---|---|---|---|
| Google Gmail | `google-gmail` | OAuth 2.0 | [google.md](./google.md) |
| Google Drive | `google-drive` | OAuth 2.0 | [google.md](./google.md) |
| Google Sheets | `google-sheets` | OAuth 2.0 | [google.md](./google.md) |
| Google Calendar | `google-calendar` | OAuth 2.0 | [google.md](./google.md) |
| Google Gemini | `google-gemini` | OAuth 2.0 | [google.md](./google.md) |
| GitHub | `github` | OAuth App | [github.md](./github.md) |
| Slack | `slack` | OAuth 2.0 (v2 bot) | [slack.md](./slack.md) |
| Jira (Atlassian Cloud) | `atlassian-jira` | OAuth 2.0 (3LO) | [atlassian-jira.md](./atlassian-jira.md) |
| Confluence (Atlassian Cloud) | `atlassian-confluence` | OAuth 2.0 (3LO) | [atlassian-confluence.md](./atlassian-confluence.md) |
| Bitbucket Cloud | `atlassian-bitbucket` | OAuth 2.0 (workspace consumer) | [atlassian-bitbucket.md](./atlassian-bitbucket.md) |
| Asana | `asana` | OAuth 2.0 | [asana.md](./asana.md) |

## Shared conventions

### Callback URL pattern

Every plugin's OAuth redirect URL follows the same shape:

```
https://<your-a-workbench-host>/api/auth/<plugin-name>/callback
```

For local development swap host for `http://localhost:3000`.

### Environment variable naming

Per-plugin OAuth client credentials use the convention:

```
<PROVIDER>_CLIENT_ID
<PROVIDER>_CLIENT_SECRET
```

Examples:
```bash
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET          # also used for portal SSO
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
SLACK_CLIENT_ID / SLACK_CLIENT_SECRET
ATLASSIAN_JIRA_CLIENT_ID / ATLASSIAN_JIRA_CLIENT_SECRET
ATLASSIAN_CONFLUENCE_CLIENT_ID / ATLASSIAN_CONFLUENCE_CLIENT_SECRET
ATLASSIAN_BITBUCKET_CLIENT_ID / ATLASSIAN_BITBUCKET_CLIENT_SECRET
ASANA_CLIENT_ID / ASANA_CLIENT_SECRET
```

> Note: today only `GOOGLE_*` is wired (portal SSO via `packages/server/src/auth/google.ts`). Per-plugin OAuth credential storage and admin-portal entry is on the roadmap — see `goal.md` and the design plan in `docs/architecture.md`.

### Where credentials are stored

| Item | Storage |
|---|---|
| OAuth client ID/secret (yours, the integrator) | env vars (current) → admin-managed `oauth_apps` table (planned) |
| User access/refresh tokens | `connections` table, encrypted AES-256-GCM (`packages/server/src/db.ts`) |
| Auth state nonce | `pending_auth` table, 10-min TTL |

### Scope hygiene

Each provider doc lists scopes copied from the plugin manifest. Whenever you add a scope:

1. Update `manifest.ts`.
2. Add it in the provider's developer console (consent screen / permissions tab).
3. Have every connected user re-consent — refresh tokens **do not** auto-upgrade scopes.

## Keeping these docs fresh

Provider consoles change UI labels frequently. When a doc looks stale:

1. Fetch the official URL listed at the bottom of the page.
2. Update steps + bump the "Last verified" date.
3. Note any URL/menu rename in the relevant troubleshooting table.
