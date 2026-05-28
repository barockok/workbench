# Atlassian Cloud — jira + confluence (retry)

**Date:** 2026-05-29
**Branch:** `uat/mcp-claude-sdk`
**Tester (portal SSO):** account on the Atlassian app allowlist (resolved earlier blocker — the app is in dev, only allowlisted users get past consent)
**Sites:** `amartha.atlassian.net` (jira) and `amartha-confluence.atlassian.net` (confluence)
**Verdict:** **PASS** — both Atlassian Cloud plugins now connect end-to-end and answer real `execute_tool` calls. Two unrelated upstream plugin issues called out below.

---

## Result

| Plugin              | Connect                                | execute_tool sample                                | Result |
|---------------------|----------------------------------------|----------------------------------------------------|--------|
| atlassian-jira      | PASS — site picker → `amartha.atlassian.net`           | `jira_project_types` `{}`                          | PASS — real project type list (`product_discovery`, …) |
| atlassian-jira      |                                        | `jira_search_issues` `{jql:"assignee=currentUser()", maxResults:3}` | UPSTREAM — `The requested API has been removed. Please migrate to /rest/api/3/search/jql` |
| atlassian-confluence| PASS — site picker → `amartha-confluence.atlassian.net` | `confluence_search_pages` `{query:"UAT"}`         | PASS — real Confluence page `UAT` (`id: 6897795134`) |
| atlassian-confluence|                                        | `confluence_list_spaces` `{}`                      | UPSTREAM — `Unauthorized; scope does not match` (plugin needs `read:space:confluence` or similar — granted scopes are `read:confluence-content.summary write:confluence-content search:confluence`) |

Dashboard: **11 LIVE** (`google-{gmail,drive,sheets,calendar,gemini,docs,slides}`, `atlassian-{jira,confluence,bitbucket}`, `httpbin-cookie`). Screenshot: `dashboard-11-live.png` (gitignored).

---

## Bug found + fixed: plugins ship literal `cloud-id` placeholder

### Symptom

After both Atlassian OAuth flows succeeded and tokens were stored, every jira / confluence tool call returned the same shape:
```
{"timestamp":"2026-05-28T…","status":404,"error":"Not Found",
 "path":"/ex/jira/cloud-id/rest/api/3/search"}
```
Note the literal string `cloud-id` in the path — the plugin handlers send URLs like
```ts
ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/search?${params}`)
```
without resolving the actual Atlassian cloud ID. Atlassian's edge happily routes the request, doesn't find a tenant called `cloud-id`, returns 404.

(Repro: `grep -n "cloud-id" packages/plugins/atlassian-jira/tools/index.ts packages/plugins/atlassian-confluence/tools/index.ts` shows ~12 hits across the two plugins.)

### Fix

Did **not** touch every plugin call site. Instead patched `createContext` in `packages/server/src/plugins/context.ts` so `ctx.http` transparently resolves the cloud ID when it sees the placeholder:

- New helper `resolveAtlassianCloudId(token, product)` calls `https://api.atlassian.com/oauth/token/accessible-resources` and picks the site whose scopes mention the requested product (`jira` or `confluence`).
- Result cached in a module-level `Map<userId:product, cloudId>` so we don't hit `/accessible-resources` on every tool call.
- Before issuing the outbound request, regex-match `/^https:\/\/api\.atlassian\.com\/ex\/(jira|confluence)\/cloud-id\//` and substring-replace `cloud-id` with the resolved ID. Anything that doesn't match the pattern flows through untouched.

After the fix the same `jira_project_types` call returned a real JSON array of project types; `confluence_search_pages query=UAT` returned a real page row from the Confluence space.

### Why patch in `ctx`, not the plugins

- One change point vs. ~12 call sites across two plugins (and the same shape is going to show up the next time a Google / Microsoft / Slack plugin needs a tenant ID).
- Plugins should not own multi-step OAuth resource discovery — they only know their resource shape, not how their host handles tenanting.
- Cleanly leaves the plugin code unchanged so the registry / manifests stay accurate.

---

## Other findings (upstream, not OAuth/MCP)

- **`jira_search_issues` calls a deprecated endpoint.** Atlassian removed `/rest/api/3/search` (CHANGE-2046). Plugin needs to switch to `/rest/api/3/search/jql`. Same fix shape for any other `/search` callers — out of scope for this UAT.
- **`confluence_list_spaces` is denied with `Unauthorized; scope does not match`.** Plugin manifest currently requests `read:confluence-content.summary write:confluence-content search:confluence`. Listing spaces wants `read:space:confluence` (or the legacy `read:confluence-space.summary`). The OAuth grant succeeded for the scopes we asked, the upstream API just refuses the call.

Neither of these blocks the matrix — every other connected tool resolves correctly through the cloudId fix.

---

## Updated overall matrix

Combining the previous matrix (`2026-05-29-plugin-matrix-e2e.md`) with this retry:

| Connected | google-gmail, google-drive, google-sheets, google-calendar, google-gemini, google-docs, google-slides, atlassian-jira, atlassian-confluence, atlassian-bitbucket, httpbin-cookie |
|-----------|---|
| Blocked   | asana / github / slack — no plugin OAuth client in `~/Desktop/workbench-keys/` |

11 of 14 plugins connected and validated through `/mcp execute_tool` for a real Atlassian-tenant user.

---

## Credential / PII hygiene

- Tester identity not named in this report; the dashboard screenshot containing the email is gitignored (`*.png`).
- API key minted by `UPDATE users SET api_key_hash` lives only in `uat-dir/.mcp.json` (gitignored) and the runtime memory of this session.
- Pre-commit cred grep on staged changes: clean.
