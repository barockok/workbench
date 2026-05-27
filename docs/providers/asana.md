# Asana — OAuth Credential Setup

Plugin: `packages/plugins/asana`
Auth type: OAuth 2.0 (Authorization Code)
Last verified against official docs: 2026-05-27

Scopes used (from `manifest.ts`):
`default` (full user permissions — Asana's catch-all classic scope)

---

## 1. Register the app

1. Open https://app.asana.com/0/my-apps
2. **Create new app**
3. Name: `a-workbench`
4. Read and accept Asana API terms
5. **Create app**

## 2. Configure OAuth

Inside the app → **OAuth** tab.

| Field | Value |
|---|---|
| Redirect URLs | `https://<your-a-workbench-host>/api/auth/asana/callback` |
| Local dev redirect | `http://localhost:3000/api/auth/asana/callback` (Asana allows http for localhost) |

> Native-app fallback only: use `urn:ietf:wg:oauth:2.0:oob` for out-of-band — not relevant for a-workbench.

### Permission scopes

Asana supports two modes:

- **Full permissions** (`default` scope) — what the plugin manifest uses today. Token can do everything the connecting user can do.
- **Granular scopes** — opt-in mode where you select narrow scopes like `tasks:read`, `projects:write`, `goals:read`. If you switch, the manifest scope list must mirror the console exactly or the auth call returns `forbidden_scope`.

Stay on Full permissions unless you have a specific reason to lock down.

## 3. Grab credentials

Same OAuth tab → app shows:

- **Client ID**
- **Client secret** (click reveal)

```bash
ASANA_CLIENT_ID=...
ASANA_CLIENT_SECRET=...
```

## 4. Endpoints

| | URL |
|---|---|
| Authorization | `https://app.asana.com/-/oauth_authorize` |
| Token exchange | `https://app.asana.com/-/oauth_token` |
| Token revocation | `https://app.asana.com/-/oauth_revoke` |
| API base | `https://app.asana.com/api/1.0/` |

Access tokens last **1 hour**; refresh tokens are long-lived and do **not** rotate.

## 5. Distribution

By default new apps are private to the creator's account. To distribute:
1. **Manage Distribution** → choose visibility (Limited / Public).
2. For Public listing in the Asana Apps directory, submit for review.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Redirect URI mismatch` | Add the exact URL (scheme + path) to the OAuth tab |
| `forbidden_scope` | Granular-scope mode enabled in console but manifest still requests `default` (or vice versa) |
| 401 after 1h | Access token expired — refresh using long-lived refresh token |
| 402 `Premium feature` | Endpoint needs Asana Business/Enterprise — check the API doc for the specific endpoint |
| Rate limited (429) | Free tier: 150 req/min/token; paid: 1500 req/min/token |

## References

- OAuth overview — https://developers.asana.com/docs/oauth
- Scopes (granular) — https://developers.asana.com/docs/oauth#oauth-scopes
- API quickstart — https://developers.asana.com/docs/quick-start
