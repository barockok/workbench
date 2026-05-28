# Google (Workspace) — OAuth Credential Setup

Plugins (one per product, each with its own scope and connection):
- `packages/plugins/google-gmail` — `gmail.modify`
- `packages/plugins/google-drive` — `drive`
- `packages/plugins/google-sheets` — `spreadsheets` + `drive.file`
- `packages/plugins/google-calendar` — `calendar`
- `packages/plugins/google-gemini` — `generative-language.retriever`

Auth type: OAuth 2.0 (Authorization Code, with refresh tokens)
Last verified against official docs: 2026-05-28

Splitting means a user can connect (e.g.) only Gmail without granting Drive access. Each plugin has its own row in the `connections` table and its own consent prompt.

---

## 1. Create / select a Google Cloud project

1. Open https://console.cloud.google.com/projectcreate
2. Name it (e.g. `a-workbench-prod`) and create.
3. Enable billing if prompted (required for some APIs even on free quota).

## 2. Enable required APIs

In the [API Library](https://console.cloud.google.com/apis/library), enable each API matching the scopes you want to expose:

| Scope | API to enable | Plugin |
|---|---|---|
| `gmail.modify` | Gmail API | `google-gmail` |
| `drive` | Google Drive API | `google-drive` |
| `spreadsheets` | Google Sheets API | `google-sheets` |
| `calendar` | Google Calendar API | `google-calendar` |
| `generative-language.retriever` | Generative Language API | `google-gemini` |

Disable APIs you don't need — fewer APIs = simpler verification.

## 3. Configure the OAuth consent screen

1. Go to https://console.cloud.google.com/auth/overview
2. User type: **Internal** if your Google Workspace org owns it (no verification needed); **External** otherwise.
3. Fill app name, support email, developer contact.
4. **Scopes** tab → add only the scopes for the plugins you will enable (one consent screen can cover all 5 clients if they share the same project):
   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/drive
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/generative-language.retriever
   ```
5. **Test users** tab → add every Google account that will connect while the app is in `Testing` status. Without this, you'll get `Error 403: access_denied`.

### Verification (External apps only)

Most of these scopes are **sensitive** or **restricted** (Gmail, Drive). To leave Testing → Production for external users you must submit for OAuth verification — Google requires a homepage, privacy policy, demo video, and (for Gmail/Drive) an independent CASA security assessment. For internal Workspace use this is not required.

Refs:
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://support.google.com/cloud/answer/9110914 (OAuth verification FAQ)

## 4. Create OAuth 2.0 Clients

You need **6 clients total** — 1 for portal SSO, 5 for the plugins (one per plugin).

### Portal SSO client

1. https://console.cloud.google.com/auth/clients → **Create Client** → **Web application**
2. Name: `a-workbench portal SSO`
3. **Authorized redirect URIs**:
   ```
   https://<your-a-workbench-host>/api/auth/google/callback
   http://localhost:3000/api/auth/google/callback
   ```
4. **Create** → copy → `.env`:
   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### Plugin clients (one per product)

Repeat for each plugin. Each client gets **only its own** redirect URI.

| Client name | Redirect URI (production) | Redirect URI (local dev) |
|---|---|---|
| `a-workbench gmail` | `https://<host>/api/auth/plugin/google-gmail/callback` | `http://localhost:3000/api/auth/plugin/google-gmail/callback` |
| `a-workbench drive` | `https://<host>/api/auth/plugin/google-drive/callback` | `http://localhost:3000/api/auth/plugin/google-drive/callback` |
| `a-workbench sheets` | `https://<host>/api/auth/plugin/google-sheets/callback` | `http://localhost:3000/api/auth/plugin/google-sheets/callback` |
| `a-workbench calendar` | `https://<host>/api/auth/plugin/google-calendar/callback` | `http://localhost:3000/api/auth/plugin/google-calendar/callback` |
| `a-workbench gemini` | `https://<host>/api/auth/plugin/google-gemini/callback` | `http://localhost:3000/api/auth/plugin/google-gemini/callback` |

Map each to its env var (see `.env.example`):
```bash
GOOGLE_GMAIL_CLIENT_ID=...
GOOGLE_GMAIL_CLIENT_SECRET=...
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
# ... etc
```

> The downloaded `client_secret.json` is convenient but optional — only the two values are needed.

## 5. Wire credentials into a-workbench

### Portal SSO (login)

These env vars already power Google SSO into the portal — see `.env.example`:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Restart the server after setting.

### Plugin OAuth (tool calls)

Each plugin's credentials are set per step 4 above. Env var naming convention: `<PLUGIN_NAME_UPPER_SNAKE>_CLIENT_ID/SECRET`. The loader reads these directly from `process.env` — no `config.ts` entry needed when you add a new plugin.

All 5 clients can live in the **same GCP project + same consent screen**, as long as the screen lists every scope each client requests. You can also use separate projects per plugin if you want maximum isolation (independent billing, separate verification timelines).

## 6. First connection

1. Start the server (`npm run dev`) and portal.
2. Sign in via Google SSO.
3. From the portal Connections page, click **Connect** on any Google plugin card (Gmail, Drive, Sheets, Calendar, Gemini).
4. Approve the consent screen — Google lists only the scopes for that plugin's `manifest.ts`.
5. You're redirected back to `/api/auth/plugin/<name>/callback` → token stored encrypted in `connections`.
6. Repeat for each plugin you want to enable. Grants are independent — connecting Gmail does not auto-connect Drive.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Error 400: redirect_uri_mismatch` | Redirect URI in step 4 does not exactly match (scheme/host/port/path). Trailing slash matters. |
| `Error 403: access_denied` while Testing | Account not in **Test users**, or scope not added to consent screen. |
| `invalid_grant` on refresh | Refresh token revoked (user removed access at https://myaccount.google.com/permissions) or app moved Testing→Production resetting tokens. Re-connect. |
| Missing scope at call time | Add scope to both consent screen *and* `manifest.ts`, then have the user re-connect (Google does not auto-upgrade scope grants). |
| 429 / quota errors | Check per-API quotas in Cloud Console → API → Quotas. Gemini Generative Language has aggressive default limits. |

## References

- OAuth 2.0 for web server apps — https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth scopes — https://developers.google.com/identity/protocols/oauth2/scopes
- Gmail scopes — https://developers.google.com/gmail/api/auth/scopes
- Drive scopes — https://developers.google.com/drive/api/guides/api-specific-auth
- OAuth verification policy — https://support.google.com/cloud/answer/9110914
