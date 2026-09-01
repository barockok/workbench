---
title: Google setup & scopes
description: Create the Google Cloud project, consent screen, and seven OAuth clients that the google-* plugins need.
---

Google Workspace ships as **seven separate plugins**, one per product. Each has its own manifest, its own scopes, its own OAuth client, and its own row in the connections table. A user who connects Gmail grants Gmail only. Drive stays unconnected until they connect it too.

That split is the point: one consent prompt per product, and no way for a Calendar tool to reach a user's mail. It does mean the operator setup is one Cloud project with several clients, rather than one client for everything.

| Plugin | Scopes |
|---|---|
| `google-gmail` | `https://www.googleapis.com/auth/gmail.modify` |
| `google-drive` | `https://www.googleapis.com/auth/drive` |
| `google-docs` | `https://www.googleapis.com/auth/documents`, `https://www.googleapis.com/auth/drive.file` |
| `google-sheets` | `https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/drive.file` |
| `google-slides` | `https://www.googleapis.com/auth/presentations`, `https://www.googleapis.com/auth/drive.file` |
| `google-calendar` | `https://www.googleapis.com/auth/calendar` |
| `google-gemini` | `https://www.googleapis.com/auth/generative-language.retriever` |

Per-plugin tool lists are on [Google tools](google-tools.md).

## The shared scope model

Each plugin asks for the narrowest scope that still lets its tools work. It adds `drive.file` where the product needs to create or find its own documents.

`drive.file` is per-file, not per-drive: it grants access only to files the app itself created or the user explicitly opened with it. That is why Docs, Sheets, and Slides can create documents and search for their own without holding the full `drive` scope. The `google-drive` plugin does hold full `drive`, because a general file manager has to see files it did not create.

`gmail.modify` covers reading, sending, drafting, and label changes, but not permanent deletion.

## Set up

> [!NOTE] The console steps are Google's UI, not this server's
> Menu names, labels, and page URLs below come from Google's console and change
> without notice. If what you see differs, follow [Google's own documentation](https://developers.google.com/identity/protocols/oauth2) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create or pick a Cloud project

[console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate). One project can hold all seven clients.

### Enable one API per plugin you will ship

In the [API Library](https://console.cloud.google.com/apis/library), enable only what you need:

| Plugin | API |
|---|---|
| `google-gmail` | Gmail API |
| `google-drive` | Google Drive API |
| `google-docs` | Google Docs API |
| `google-sheets` | Google Sheets API |
| `google-slides` | Google Slides API |
| `google-calendar` | Google Calendar API |
| `google-gemini` | Generative Language API |

Fewer enabled APIs means a smaller verification surface later.

### Configure the consent screen

[console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview). Choose **Internal** if a Google Workspace org owns the project — no verification needed — or **External** otherwise.

Under **Scopes**, add every scope string from the table at the top of this page that belongs to a plugin you are enabling. One consent screen covers all seven clients.

Under **Test users**, add every Google account that will connect while the app is in Testing status. Without this they get `Error 403: access_denied`.

### Create the portal SSO client

Only if you are using Google for portal login. [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients) → **Create Client** → **Web application**, with redirect URIs:

```
https://<your-workbench-host>/api/auth/google/callback
http://localhost:3000/api/auth/google/callback
```

This client is portal login only. Its credentials go in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and are never used by any `google-*` plugin.

### Create one client per plugin

Repeat **Create Client** → **Web application** for each plugin. Each gets only its own redirect URI:

| Plugin | Redirect URI |
|---|---|
| `google-gmail` | `https://<host>/api/auth/plugin/google-gmail/callback` |
| `google-drive` | `https://<host>/api/auth/plugin/google-drive/callback` |
| `google-docs` | `https://<host>/api/auth/plugin/google-docs/callback` |
| `google-sheets` | `https://<host>/api/auth/plugin/google-sheets/callback` |
| `google-slides` | `https://<host>/api/auth/plugin/google-slides/callback` |
| `google-calendar` | `https://<host>/api/auth/plugin/google-calendar/callback` |
| `google-gemini` | `https://<host>/api/auth/plugin/google-gemini/callback` |

Add the `http://localhost:3000` equivalent to the same client for local development.
:::

## Server configuration

One pair per plugin, named after the plugin:

```bash
GOOGLE_GMAIL_CLIENT_ID=...
GOOGLE_GMAIL_CLIENT_SECRET=...
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DOCS_CLIENT_ID=...
GOOGLE_DOCS_CLIENT_SECRET=...
GOOGLE_SHEETS_CLIENT_ID=...
GOOGLE_SHEETS_CLIENT_SECRET=...
GOOGLE_SLIDES_CLIENT_ID=...
GOOGLE_SLIDES_CLIENT_SECRET=...
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_GEMINI_CLIENT_ID=...
GOOGLE_GEMINI_CLIENT_SECRET=...
```

> [!WARNING] `GOOGLE_CLIENT_ID` is not a fallback
> It configures portal SSO and nothing else. A `google-*` plugin with no `_CLIENT_ID` of its own shows as unconfigured in the portal. It will not connect, no matter what `GOOGLE_CLIENT_ID` is set to.

## Connect

Portal: Connections → **Connect** on each Google card you want. Google lists only that plugin's scopes on the consent screen. Grants are independent — connecting Gmail does not connect Drive.

Agent:

```
connect({ integration: "google-gmail" })
wait_for_connection({ connectionId })
```

The server adds `access_type=offline`, `prompt=consent`, and `include_granted_scopes=true` to every `google-*` authorize request, so each connection comes back with a refresh token.

## Notes and gotchas

Google classes several of these scopes as sensitive or restricted, the Gmail and Drive ones especially. An External app publishing to Production therefore goes through Google's verification process. An app whose scopes are restricted has additional requirements on top. Google defines what that process demands, and it changes over time. Check [Google's OAuth verification documentation](https://support.google.com/cloud/answer/13463073) before you plan around it. An Internal Workspace app does not go through it.

`Error 400: redirect_uri_mismatch` means the URI registered on the client and the one the server sends are not the same string. Register exactly what this server builds — scheme, host, port, and path all matter, and `/api/auth/plugin/google-gmail/callback` is not the same as the portal's own `/api/auth/google/callback`.

`invalid_grant` on refresh means Google no longer honours the stored refresh token — a revoked grant at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) is the common cause. Whatever the reason, the fix from this server's side is the same: the user reconnects.

Adding a scope to a manifest does not upgrade an existing grant. Add it to the consent screen as well, then have each user reconnect.

Quotas are set per API by Google, not by this server, and are visible in the Cloud Console under APIs → Quotas. For the Gemini plugin specifically, see [the Gemini API rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
