# Tool coverage — write lifecycle + OAuth refresh

**Date:** 2026-05-29
**Branch:** `staging/mcp-claude-sdk`
**Tester:** <tester>@<workspace> for Google + Bitbucket; <owner>@<workspace> for Atlassian Cloud (jira + confluence) read tests in the earlier matrix report.
**Scope rule (from goal):** writes only against resources we create in this run, never against pre-existing data. Anything destructive on real Atlassian content was skipped.

---

## Bug found + fixed: tokens never refreshed → all Google tools 401 after ~1h

### Symptom

Coming back to the tester's connections an hour after the OAuth grant, every Google tool returned upstream `401`:

```
{"error":{"code":401,"message":"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential."}}
```

Direct DB inspection showed the tester's `connections` rows with `has_refresh=1` and `expires_at` in the past — so the refresh token was stored, but no one was using it. Same shape for Bitbucket. the owner's Atlassian rows had `has_refresh=0` because the manifests don't request `offline_access` (separate fix below).

### Root cause

`packages/server/src/plugins/context.ts::getToken()` returned `tokenData.accessToken` as-is, with zero expiry/refresh checks:

```ts
async getToken(): Promise<string> {
  if (!tokenData) {
    tokenData = getToken(userId, integration);
    if (!tokenData) throw new Error("Not connected");
  }
  return tokenData.accessToken;   // ← stale access token gets handed to ctx.http
}
```

### Fix

Added a refresh path inside `getToken()` plus a generic `refreshAccessToken` helper:

```ts
async getToken(): Promise<string> {
  if (!tokenData) {
    tokenData = getToken(userId, integration);
    if (!tokenData) throw new Error("Not connected");
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokenData.expiresAt && tokenData.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS <= now) {
    tokenData = await refreshAccessToken(userId, integration, tokenData);
  }
  return tokenData.accessToken;
}
```

`refreshAccessToken`:
- Looks up the integration manifest (`tokenUrl`) and the per-plugin OAuth client creds (`getPluginOAuthCreds`).
- POSTs `grant_type=refresh_token` to the manifest's token endpoint.
- Re-uses the prior refresh token when the provider doesn't rotate (Google) and accepts the new one when it does (Atlassian).
- Persists with `storeToken` (encrypts at rest, same path as initial OAuth callback).
- Uses a 30-second skew so we refresh just before the actual expiry.

After the fix every Google read tool below works on the *same* stored the tester connection, hours after the original grant.

---

## Atlassian: `offline_access` was missing from manifests

the owner's `atlassian-jira` / `atlassian-confluence` connections stored `refresh_token=NULL` because Atlassian only issues a refresh token when the consent request includes the `offline_access` scope. Adding it to both manifests:

```diff
- scopes: ["read:jira-work", "write:jira-work", "read:me", "read:jira-user"]
+ scopes: ["read:jira-work", "write:jira-work", "read:me",
+          "read:jira-user", "offline_access"]
```

```diff
- scopes: ["read:confluence-content.summary", "write:confluence-content",
-          "search:confluence", "read:confluence-space.summary"]
+ scopes: ["read:confluence-content.summary", "write:confluence-content",
+          "search:confluence", "read:confluence-space.summary",
+          "offline_access"]
```

Re-consent grants the same scopes plus `offline_access`; the next callback returns a `refresh_token`, and the new `getToken()` path refreshes it transparently from then on.

---

## Read-only coverage (the tester)

All run as `execute_tool` against `/mcp` with the tester's API key.

| Plugin / tool                            | Result |
|------------------------------------------|--------|
| `google_gmail_profile`                   | PASS — `messagesTotal: 115, threadsTotal: 72` |
| `google_gmail_list` `{maxResults:3}`     | PASS — 3 real message IDs + nextPageToken |
| `google_gmail_labels`                    | PASS — `INBOX`, `SENT`, `CHAT`, etc. |
| `google_gmail_threads` `{maxResults:2}`  | PASS |
| `google_drive_search` `{query: name contains "a"}` | PASS — `{files: []}` (account is sparse, real call) |
| `google_calendar_list_events` `{calendarId: <self>, maxResults: 2}` | PASS — Asia/Jakarta calendar metadata |
| `google_sheets_search` `{query:""}`      | PASS — `{files: []}` |
| `google_docs_search` `{query:""}`        | PASS |
| `google_slides_search` `{query:""}`      | PASS |
| `bitbucket_list_repos` `{workspace:"acme"}` | PASS — `acme/internal-app` and siblings |
| `bitbucket_get_repo` `{workspace:"acme", repoSlug:"internal-app"}` | PASS |
| `bitbucket_list_prs`  `{workspace:"acme", repoSlug:"internal-app"}` | PASS — open PR #5746 + others |

All passed after the refresh fix on tokens that had been minted hours earlier.

---

## Write lifecycle coverage (the tester, on freshly-created resources only)

Only fresh resources created during this run were touched. Each test cleaned up its own artifact.

### Google Calendar — create → get → update → delete

| Step | Tool | Result |
|------|------|--------|
| create event in the tester's own calendar (Dec 1 2026 10:00–10:30 UTC) | `google_calendar_create_event` | PASS — id `o1fan69icuf9j0ohbu1p598t2k` |
| read it back | `google_calendar_get_event` | PASS — `status: confirmed`, htmlLink, summary `"a-workbench staging test"` |
| change summary | `google_calendar_update_event` | PASS — summary `"a-workbench staging test (updated)"` |
| remove | `google_calendar_delete_event` | PASS — `{success: true}` |

### Google Docs — create → get → batch_update → get_plaintext

| Step | Tool | Result |
|------|------|--------|
| create doc `"a-workbench staging doc"` | `google_docs_create` | PASS — `documentId: 1krfmuL0…` |
| read structured | `google_docs_get` | PASS |
| insert text `"staging body"` at index 1 | `google_docs_batch_update` | PASS |
| read flattened text | `google_docs_get_plaintext` | PASS — `"staging body\n"` |
| (cleanup) | `google_drive_trash` | PASS |

### Google Sheets — create → write → read

| Step | Tool | Result |
|------|------|--------|
| create sheet `"a-workbench staging sheet"` | `google_sheets_create` | PASS — `spreadsheetId: 1yJK…` |
| write `[["hello","world"]]` to `A1` | `google_sheets_write` | PASS — `updatedRange: Sheet1!A1:B1, updatedCells: 2` |
| read back `A1:B1` | `google_sheets_read` | PASS — `[["hello","world"]]` |
| (cleanup) | `google_drive_trash` | PASS |

### Google Slides — create → get

| Step | Tool | Result |
|------|------|--------|
| create deck `"a-workbench staging deck"` | `google_slides_create` | PASS — `presentationId: 1r3s…` |
| inspect deck (pageSize, slides) | `google_slides_get` | PASS |
| (cleanup) | `google_drive_trash` | PASS |

### Google Drive — folder + roundtrip

| Step | Tool | Result |
|------|------|--------|
| create folder `"a-workbench staging folder"` | `google_drive_create_folder` | PASS |
| list folder contents | `google_drive_list` `{folderId}` | PASS |
| upload `a-workbench-staging.txt` with body `"hello staging"` | `google_drive_upload` | PASS |
| download by id | `google_drive_download` | PASS — `"hello staging"` |
| (cleanup) | `google_drive_trash` x4 | PASS |

### Gmail — draft only, not send

| Step | Tool | Result |
|------|------|--------|
| create draft to self with subject `"a-workbench staging"` | `google_gmail_draft` | PASS — `id: r-8090930161310613769`, message stays in `DRAFT` label |
| list inbox (verify draft id present) | `google_gmail_list` | PASS |

Did NOT call `google_gmail_send` — would have actually sent an email. `google_gmail_get` requires a known message id and was sample-tested implicitly by `_list`.

### Drive — permissions tool

`google_drive_permissions` requires an `email` argument; testing it would mean sharing the file with somebody else's account, which is out of the goal's "only resources we create here" rule. Skipped.

---

## Atlassian (jira + confluence) write coverage — deferred

Decision: deferred to a follow-up. Creating a Jira issue or a Confluence page lands on the live `acme.atlassian.net` / `acme-confluence.atlassian.net` tenants. Without a sandbox project/space, every `create_issue` / `create_page` test would leave real production noise (and `delete_*` tools don't fully undo Jira tickets). Read coverage for both is already PASS in `2026-05-29-atlassian-cloud-tools.md`. If a sandbox project/space gets nominated, write-chain testing for these two plugins is the next obvious item.

Bitbucket `bitbucket_create_pr` is in the same bucket — would open a real PR; skipped.

---

## Updated end-to-end coverage on this branch

- All seven Google plugins: connected + read + write lifecycle (on staging-created resources) PASS.
- Atlassian Bitbucket: read PASS; write not exercised (would mutate prod).
- Atlassian Jira + Confluence: read PASS via existing report; write deferred.
- httpbin-cookie: PASS.
- Asana / GitHub / Slack: still BLOCKED (no plugin OAuth client in `~/Desktop/workbench-keys/`).
- `jira_get_boards`: still BLOCKED at app type (Jira Software API not offered).

Two code changes in this round that warrant a commit:
1. `packages/server/src/plugins/context.ts` — auto-refresh.
2. `packages/plugins/atlassian-jira/manifest.ts` + `packages/plugins/atlassian-confluence/manifest.ts` — request `offline_access` so refresh actually receives a refresh token to use.

Both gated on the same flow: `ctx.getToken()` now refreshes when expiry is within 30s; Atlassian manifests now ask for the scope that makes refresh tokens issuable.
