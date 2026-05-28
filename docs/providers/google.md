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

| Scope | API to enable |
|---|---|
| `gmail.modify` | Gmail API |
| `drive` | Google Drive API |
| `spreadsheets` | Google Sheets API |
| `documents` | Google Docs API |
| `presentations` | Google Slides API |
| `calendar` | Google Calendar API |
| `meetings.space.readonly` | Google Meet REST API |
| `generative-language.retriever` | Generative Language API |

Disable APIs you don't need — fewer APIs = simpler verification.

## 3. Configure the OAuth consent screen

1. Go to https://console.cloud.google.com/auth/overview
2. User type: **Internal** if your Google Workspace org owns it (no verification needed); **External** otherwise.
3. Fill app name, support email, developer contact.
4. **Scopes** tab → add every scope your `manifest.ts` lists:
   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/drive
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/documents
   https://www.googleapis.com/auth/presentations
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/meetings.space.readonly
   https://www.googleapis.com/auth/generative-language.retriever
   ```
5. **Test users** tab → add every Google account that will connect while the app is in `Testing` status. Without this, you'll get `Error 403: access_denied`.

### Verification (External apps only)

Most of these scopes are **sensitive** or **restricted** (Gmail, Drive). To leave Testing → Production for external users you must submit for OAuth verification — Google requires a homepage, privacy policy, demo video, and (for Gmail/Drive) an independent CASA security assessment. For internal Workspace use this is not required.

Refs:
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://support.google.com/cloud/answer/9110914 (OAuth verification FAQ)

## 4. Create the OAuth 2.0 Client ID

1. Go to https://console.cloud.google.com/auth/clients
2. **Create Client** → **Web application**
3. Name: anything (e.g. `a-workbench server`)
4. **Authorized redirect URIs** — add:
   ```
   https://<your-a-workbench-host>/api/auth/google/callback
   ```
   For local dev also add:
   ```
   http://localhost:3000/api/auth/google/callback
   ```
   Path must match the route registered in `packages/server/src/api/routes.ts`.
5. **Create** → copy the **Client ID** and **Client secret**.

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

Per-user Google Workspace tool access (Gmail, Drive, etc.) uses a separate code path. Two options:

All 5 sub-plugins share **one** OAuth client (same GCP project, same consent screen). Each plugin has its **own** callback path — register every one in the GCP OAuth client's Authorized redirect URIs list:

```
${SERVER_PUBLIC_URL}/api/auth/plugin/google-gmail/callback
${SERVER_PUBLIC_URL}/api/auth/plugin/google-drive/callback
${SERVER_PUBLIC_URL}/api/auth/plugin/google-sheets/callback
${SERVER_PUBLIC_URL}/api/auth/plugin/google-calendar/callback
${SERVER_PUBLIC_URL}/api/auth/plugin/google-gemini/callback
```

Local dev — add each with `http://localhost:3000` prefix too.

**Option A — share with SSO (quickest):** leave `GOOGLE_PLUGIN_CLIENT_ID/SECRET` unset; the plugin code path falls back to `GOOGLE_CLIENT_ID/SECRET`.

**Option B — separate client (recommended):** create a second Web Application client in step 4 (name it `a-workbench google plugin`). Use the redirect URIs above. Then:

```bash
GOOGLE_PLUGIN_CLIENT_ID=<client-b-id>
GOOGLE_PLUGIN_CLIENT_SECRET=<client-b-secret>
SERVER_PUBLIC_URL=https://<your-host>
```

Either way, the consent screen must list every plugin scope (step 3) — Google enforces this at the consent screen level, not per OAuth client.

## 6. First connection

1. Start the server (`npm run dev`) and portal.
2. Sign in via Google SSO.
3. From the portal Connections page, click **Connect** on the Google card.
4. Approve the consent screen — Google will list every scope from `manifest.ts`.
5. You're redirected back to `/callback/google` → token stored encrypted in `connections`.

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
