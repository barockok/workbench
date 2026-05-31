# Plugin matrix — end-to-end (browser connect + MCP execute_tool)

**Date:** 2026-05-29
**Branch:** `staging/mcp-claude-sdk`
**Tester (portal SSO):** `<tester>@<workspace>` (Google account, browser-driven flow)
**Stack:** portal `:3000`, server `:3001`, sample-oauth `:3002` (local `npm run dev`)
**Goal:** Validate every plugin/app, prioritizing Google + Atlassian. Each plugin connected via the browser, then an `execute_tool` round-trip through `/mcp` confirmed it works for the SSO user.

---

## Result matrix

| # | Plugin              | Connect | execute_tool                  | Notes |
|---|---------------------|---------|--------------------------------|-------|
| 1 | google-gmail        | PASS    | `google_gmail_profile` → real email + 112 messages / 69 threads | shared GCP client |
| 2 | google-drive        | PASS    | `google_drive_list` → `{files: [], kind: "drive#fileList"}` | empty drive, OK |
| 3 | google-sheets       | PASS    | `google_sheets_search` query=`staging` → `{files: []}` | OK |
| 4 | google-calendar     | PASS    | `google_calendar_list_calendars` → primary calendar `<tester>@<workspace>` returned | OK |
| 5 | google-gemini       | PASS    | `google_gemini_generate` model=`gemini-2.5-flash` prompt=`Say only OK` → reply `OK` | `gemini-1.5-*` 404; `gemini-2.0-flash` quota 429 |
| 6 | google-docs         | PASS    | `google_docs_search` query=`staging` → `{files: []}` | OK |
| 7 | google-slides       | PASS    | `google_slides_search` query=`staging` → `{files: []}` | OK |
| 8 | atlassian-bitbucket | PASS    | `bitbucket_list_repos` workspace=`acme` → real repo list (e.g. `acme/sample-repo`) | own OAuth app, not in dev mode |
| 9 | httpbin-cookie      | PASS    | `httpbin_get_cookies` → `{cookies: {session: "test123"}}` | cookie auth, already covered in prior report |
| – | atlassian-jira      | **BLOCKED** | n/a | Atlassian Cloud app is **in development**; consent UI says *"You don't have access to this app. This application is in development — only the owner of this application may grant it access."* Tester is not the app owner. |
| – | atlassian-confluence| **BLOCKED** | n/a | Same Atlassian Cloud app as jira — same dev-mode restriction. |
| – | asana               | BLOCKED | n/a | No `ASANA_CLIENT_ID` / `_SECRET` in `~/Desktop/workbench-keys/`. |
| – | github              | BLOCKED | n/a | No `GITHUB_CLIENT_ID` / `_SECRET` in keys dir. (Earlier staging showed the matching error: `OAuth client not configured for github`.) |
| – | slack               | BLOCKED | n/a | No `SLACK_CLIENT_ID` / `_SECRET` in keys dir. |

**Connected total: 9 / 14.** Dashboard sticky-strip read `9 LIVE · 14 INTEGRATIONS · NODE ONLINE`. Final dashboard screenshot: `dashboard-9-live.png` (gitignored — contains the tester email).

---

## Bug found + fixed: `execute_tool` was bypassing the plugin's Zod schema

### Symptom

First pass against Google plugins all returned upstream `400`s:
- `google_drive_list` → `"Invalid value at 'page_size' (TYPE_INT32), \"undefined\""`
- `google_sheets_search` → same
- `google_calendar_list_calendars` → `"Invalid integer value: 'undefined'."` for `maxResults`
- `google_docs_search`, `google_slides_search` → same shape
- `bitbucket_list_repos` → `"No workspace with identifier 'undefined'."`

The plugin code declares Zod defaults (`pageSize: z.number().default(10)` etc.), so a caller that omits them should still get a working request.

### Root cause

`packages/server/src/mcp/server.ts::execute_tool` was calling the plugin's handler with the raw `args.args` payload from the MCP request:

```ts
const toolCtx = createContext(ctx.userId, tool.integration);
const result = await tool.handler(toolCtx, args.args);
```

The MCP top-level `execute_tool` schema only validates `{ tool: string, args: record }` — it never touches the inner plugin schema. So Zod defaults on the *plugin* tool never ran. The plugin then templated `String(args.pageSize)` → `"undefined"` and sent that to Google / Bitbucket, which rejected the request.

### Fix

Run the plugin tool's own `inputSchema.safeParse(args.args ?? {})` inside `execute_tool` and forward the *parsed* args (with defaults filled in) to the handler. On parse failure, return a structured `Invalid arguments for <tool>: …` error instead of letting it leak to the upstream API.

After fix all six failing tools above returned real upstream responses (mostly empty lists for an unused workspace, which is the expected behavior). The same fix also closes a latent security gap where a caller could pass arbitrary extra keys to a plugin handler.

---

## Other findings

- **Token exchange flakiness.** First attempt to connect `google-gmail` failed with `{"error":"fetch failed"}` from `exchangeCode → fetch("https://oauth2.googleapis.com/token", …)`. `responseTime: 10510ms` in the access log — looks like a TLS / network stall, not a code bug. A retry seconds later succeeded. Worth a retry-with-timeout wrapper on `exchangeCode` but not blocking.
- **Unverified app warning.** All seven Google plugins go through the *"Google hasn't verified this app"* interstitial because the local-dev OAuth client isn't published. Tester has to click *Continue* once per plugin connect. Same behavior on the verified-test SSO client used for portal login.
- **Gemini model defaults.** Plugin's default model (`gemini-2.0-flash` per the earlier attempt) is quota-limited on this key; `gemini-2.5-flash` works. Worth either bumping the default or surfacing the model param in the schema description.
- **DeepSeek bridge limit on tool-heavy turns.** Trying to drive *three* MCP `execute_tool` calls inside one Claude Code turn against the DeepSeek anthropic-compatible endpoint returned `API Error: 400 Failed to deserialize the JSON body … messages[1].role: unknown variant 'system'`. Single-tool Claude SDK invocations (covered in the prior staging report) still work. Looks like a bug in DeepSeek's anthropic-compat shim around multi-step tool-result messages, not a workbench issue. Direct curl through `/mcp` was used as the authoritative validation channel for this matrix.

---

## Credential / PII hygiene

| Artifact | Location | Tracking status |
|----------|----------|-----------------|
| Root `.env` (encryption key, session secret, Google SSO + per-plugin OAuth client IDs/secrets) | `./.env` | gitignored (`.env`, `.env.*`) |
| Per-plugin keys source | `~/Desktop/workbench-keys/` | outside repo |
| `staging-dir/.mcp.json` (Bearer API key for the SSO user) | `staging-dir/` | gitignored (`.mcp.json`) |
| Stream-json / text transcripts | `staging-dir/*.transcript.jsonl`, `/tmp/sdk-multi.txt` | gitignored / `/tmp` only |
| Dashboard screenshot | `staging-dir/dashboard-9-live.png` | gitignored (`*.png`) |
| Tester email in this report | replaced with `<tester>@<workspace>` | safe to commit |

Pre-commit grep on staged hunks for tokens / keys / emails: clean.

---

## Reproducer summary

1. Boot stack: `npm run dev` from repo root. Portal `:3000`, server `:3001`.
2. Browser: open `http://localhost:3000`, sign in with Google as the tester.
3. For each plugin in the matrix above with `PASS` in the *Connect* column, click `Connect →` on the portal card, complete the upstream OAuth flow.
4. Mint a Bearer API key for the SSO user (see prior `2026-05-28-mcp-connected-tools-e2e.md` reproducer).
5. Drop the Bearer into `staging-dir/.mcp.json`.
6. Validate each plugin tool by POSTing JSON-RPC to `/mcp`:
   ```bash
   curl -s -X POST http://localhost:3001/mcp \
     -H "Authorization: Bearer <key>" -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
          "params":{"name":"execute_tool",
                    "arguments":{"tool":"google_gmail_profile","args":{}}}}'
   ```
   The single-tool Claude SDK path (`claude -p … --mcp-config ./.mcp.json --strict-mcp-config`) is already validated in `2026-05-28-mcp-connected-tools-e2e.md`.
