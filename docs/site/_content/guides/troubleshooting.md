---
title: Troubleshooting
description: Symptoms you are likely to hit, what causes them, and the fix — from MCP client config through container boot to provider quirks.
---

Most of what follows was found the hard way in production and written down in the
project's field notes. The table is the index; the sections below carry the detail.

## Symptom index

| Symptom | Cause | Fix |
|---|---|---|
| `MCP config is not a valid JSON`; server absent from `claude mcp list` | Syntax error, usually a trailing comma, in `.mcp.json` | Validate with `python3 -m json.tool .mcp.json`, remove the comma |
| Server listed but `mcp__workbench__*` tools missing | Config edited but not reloaded | Restart the session |
| `401` with `WWW-Authenticate: Bearer` on `/mcp` | No or invalid credential | Complete the OAuth flow, or check the API-key header |
| Authorized but every call 401s | API key sent as `Authorization: Bearer` | Move it to the `x-workbench-api-key` header |
| Calls succeed but hit the wrong data | Two similarly-named servers in the config | Check the exact `url` in `claude mcp list` |
| `Tool not found: execute_tool` | `execute_tool` (singular) does not exist | Use `execute_tools` with a one-element `executions` array |
| Container boots, every integration missing, 14× `ERR_MODULE_NOT_FOUND` | Relative `PLUGINS_DIR` reaching `import()` as a bare specifier | Fixed in the loader; if you see it, you are on an old build |
| Cookie capture fails, `fetch failed` on the CDP port | Chromium refuses to run as root without `--no-sandbox` | Passed unconditionally now; check the captured stderr tail |
| Chromium exits code 21, "profile appears to be in use … on another computer" | Stale `SingletonLock` on a shared volume after an unclean pod exit | Cleared before every spawn; check volume permissions if it persists |
| Volume fills; `tokens.db` writes fail | Browser profiles growing unbounded | Disk-discipline flags, cache trim, and the profile reaper — see below |
| Portal capture or cancel returns 400 `FST_ERR_CTP_EMPTY_JSON_BODY` | A bodyless POST declaring `Content-Type: application/json` | Send no content-type on bodyless POSTs |
| Slack tool "succeeds" but nothing happened | Slack returns HTTP 200 with `{"ok":false}` | Read `ok` in the result payload, not the transport status |
| GitHub connect fails with `Unexpected token` during token exchange | GitHub returns form-urlencoded unless asked otherwise | `Accept: application/json` is sent now; check you are on a current build |
| Confluence page operations return 410 | The removed v1 content API, or v1 scopes | Reconnect for the v2 granular scopes |
| PostgreSQL insert fails on a BOOLEAN column | `1`/`0` bound where PostgreSQL wants a real boolean | Bind a JavaScript boolean |
| Integration shows CONNECTED but every call fails | Connected means "a credential is stored", not "it works" | See the last section |

## MCP client configuration

### Invalid `.mcp.json` drops the server silently

A single trailing comma invalidates the file, and the client then drops the **whole**
server — it does not appear in `claude mcp list` at all. The only signal is:

```
[Failed to parse] Project config (shared via .mcp.json)
  └ [Error] MCP config is not a valid JSON
```

Validate before debugging anything else:

```bash
python3 -m json.tool .mcp.json
```

Two valid shapes:

:::tabs
```json [OAuth browser login]
{
  "mcpServers": {
    "workbench": {
      "url": "https://workbench.example.com/mcp"
    }
  }
}
```
```json [API key]
{
  "mcpServers": {
    "workbench": {
      "url": "https://workbench.example.com/mcp",
      "headers": { "x-workbench-api-key": "YOUR_API_KEY" }
    }
  }
}
```
:::

If `workbench` is missing from `claude mcp list`, stop — it is a config problem, not an
auth problem.

### The config is not auto-reloaded

Edits to `.mcp.json` do not take effect in a running session. Restarting the session is
the only way to pick them up. A server that loads but shows no `mcp__workbench__*` tools
is almost always a stale session rather than a broken server.

### The two credentials are not interchangeable

`Authorization: Bearer` carries an OAuth access token or a portal session JWT. The API
key travels in its own `x-workbench-api-key` header and is checked first. An API key
pasted into a `Bearer` header does not authenticate — it is not tried there.

Verify the endpoint directly:

```bash
curl -s https://workbench.example.com/mcp \
  -H 'content-type: application/json' \
  -H "x-workbench-api-key: $KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Nine tools back means the credential works and the problem is client-side.

### The OAuth redirect fails on a remote session

Signing in over SSH often leaves the browser unable to reach the client's local callback
listener. Copy the **full** `localhost:…/callback?code=…` URL out of the address bar and
hand it to the client's completion tool — the workbench's own
`/oauth/callback` landing page exists for exactly this, and does no server-side work
beyond rendering the URL for copying.

### Two workbenches, one name

A hosted aggregator and your self-hosted staging server are independent: separate
accounts, separate authorizations, separate connections. `claude mcp list` shows the
exact `url` — check it before concluding a connection vanished.

## Server boot and container

### `ERR_MODULE_NOT_FOUND` for every plugin

**Symptom:** the container boots, `list_integrations` returns almost nothing, and the log
carries one `ERR_MODULE_NOT_FOUND` per plugin directory.

**Cause:** `PLUGINS_DIR` defaults to `./plugins`. A relative path reaches Node's dynamic
`import()` as a *bare specifier*, so `plugins/slack/manifest.ts` is resolved as the npm
package `plugins` — which does not exist.

**Fix:** the loader now resolves `PLUGINS_DIR` to an absolute path before importing, and
skips built-in directories on the external pass (in the container image, `PLUGINS_DIR`
and the built-in path are the same directory). If you see this, you are running a build
from before that fix.

Related: a directory named `browser` or `jots` under `PLUGINS_DIR` is refused with
`name reserved for internal plugin`, because registration overwrites by name and those
two internal plugins carry filesystem and browser access that must not be shadowed.

A plugin that fails to load is logged and **skipped** — the server still boots, and the
integration is simply absent. Grep the boot log for `Failed to load` when an integration
is unexpectedly missing. Match on that prefix, not the full sentence: the shipped
integrations all go through the built-in pass, which logs
`Failed to load built-in plugin <name>`, while a directory under `PLUGINS_DIR` logs
`Failed to load plugin <dir>`.

### Chromium will not start as root

**Symptom:** cookie capture fails with `fetch failed` against the CDP port; Chromium
appears to start and die.

**Cause:** the container image has no `USER` directive, so the process runs as root, and
Chromium refuses to run as root without `--no-sandbox`.

**Fix:** `--no-sandbox` and `--disable-dev-shm-usage` are passed unconditionally at
spawn. The spawn path also captures the last 4KB of Chromium's stderr, so a launch
failure reports a real reason instead of a CDP connection timeout — read that tail
before guessing.

### Stale `SingletonLock` after a pod rollout

**Symptom:** Chromium exits code 21 with *"profile appears to be in use by another
Chromium process … on another computer"*, before DevTools comes up. Typically right
after a rolling deploy, an OOM kill, or any SIGKILL.

**Cause:** Chromium writes `SingletonLock` into the profile as a symlink encoding
`<hostname>-<pid>`. On a shared volume — a Kubernetes PVC, say — a pod that died
uncleanly leaves one behind naming a host that no longer exists. The next pod sees it and
refuses to start.

**Fix:** `SingletonLock`, `SingletonSocket` and `SingletonCookie` are removed before
every spawn. This is safe unconditionally because same-process sessions are already
serialised through the profile lock, so any file found there is stale by definition.

### Browser profiles fill the volume

**Symptom:** the volume holding `tokens.db` reaches capacity. Profiles are the bulk of
it, and a large share is duplicated Safe Browsing blocklists — one per profile.

**Cause:** persistent per-user profiles were introduced without anything reclaiming them.

**Fixes, all shipped and layered:**

- Spawn flags disable background networking (the blocklist download), component updates,
  client-side phishing detection, sync and crash reporting, and cap the disk cache at
  `BROWSER_DISK_CACHE_MB`.
- Caches are trimmed on the Chromium `exit` event, so a crashed browser is cleaned up
  the same as a closed one.
- A reaper sweeps every `BROWSER_PROFILE_REAP_INTERVAL_SECONDS`, trimming caches
  everywhere and deleting whole profiles idle past `BROWSER_PROFILE_TTL_DAYS`, skipping
  any with a live session.

> [!WARNING] The profile reaper deletes, and the default is 30 days
> `BROWSER_PROFILE_TTL_DAYS` defaults to `30`. A profile untouched that long is removed,
> logging that user out of every cookie integration. Set it to `0` to keep only cache
> trimming. See [Browser sessions](browser-sessions.md).

One theory worth not re-testing: slow storage was measured and ruled out as a cause of
capture latency. The problem was disk consumption, not disk speed.

## Requests and providers

### 400 `FST_ERR_CTP_EMPTY_JSON_BODY` on a bodyless POST

**Symptom:**

```json
{ "statusCode": 400, "code": "FST_ERR_CTP_EMPTY_JSON_BODY",
  "error": "Bad Request",
  "message": "Body cannot be empty when content-type is set to 'application/json'" }
```

**Cause:** several endpoints — cookie capture and cancel among them — derive everything
from the authenticated user and the route parameter, so they take no body. A client that
still sends `Content-Type: application/json` with an empty body is rejected by Fastify's
JSON parser *before the handler runs*.

**Fix:** send no `Content-Type` on a bodyless POST. If you are calling the API yourself,
send only the auth header.

### Slack returns HTTP 200 with `{"ok": false}`

Slack's Web API signals failure in the body, not the status line. A permissions problem,
a bad channel id, or a revoked token all come back as `200 OK` with `{"ok": false,
"error": "…"}`.

This has two consequences:

- **In tool results**, the handler passes the payload through. `{"result": {"ok": false,
  "error": "not_in_channel"}}` is a *successful* execution carrying a failure. Read `ok`.
- **In the OAuth exchange**, the same envelope would otherwise look like a valid token
  response. The connect path checks for it explicitly and raises
  `Slack token exchange failed: <error>`.

Two more Slack shapes worth knowing: the manifest's scopes are sent as **user** scopes,
not bot scopes — put them in the User Token Scopes box when configuring the app, and the
token arrives nested under `authed_user.access_token`. And `slack_download_file` treats
an HTML response as `not_authed_or_not_found`, because Slack answers an unauthorized
file request with a login page at status 200 rather than a 403.

### GitHub token exchange throws `Unexpected token`

**Symptom:** connecting GitHub fails during the code exchange with a JSON parse error.

**Cause:** GitHub's token endpoint returns `application/x-www-form-urlencoded` by
default. Calling `.json()` on that response throws.

**Fix:** the exchange sends `Accept: application/json`. This is shipped; seeing it now
means an old build.

### Confluence operations return 410

**Cause:** Atlassian removed the v1 content API. The integration was migrated to REST v2
(`/wiki/api/v2/pages` and `/spaces`), which needs different, granular scopes:
`read:page:confluence`, `write:page:confluence`, `delete:page:confluence`,
`read:space:confluence`, plus `search:confluence` and `offline_access`.

**Fix:** update the scopes on your Atlassian app, then **have users reconnect** — an
existing connection still carries the old scope grant, and a scope change does not
apply retroactively. The MCP tool names and arguments did not change; search still uses
CQL.

The same reconnect requirement applies to any scope addition. Bitbucket's pipeline tools
need `pipeline` and `pipeline:write`, which existing connections do not have.

### PostgreSQL rejects `1` and `0` for a BOOLEAN column

**Symptom:** an insert that works on SQLite fails on PostgreSQL.

**Cause:** SQLite stores booleans as integers and accepts `1`/`0` anywhere. PostgreSQL's
`BOOLEAN` type rejects an integer.

**Fix:** bind a real JavaScript boolean. The audit writer does this deliberately for
`audit_log.success`, and the SQLite adapter converts on the way in — so one binding works
on both backends.

Adjacent PostgreSQL traps in the same area, if you are writing queries:

- `?` is not always a placeholder. String literals, quoted identifiers, dollar-quoted
  strings and the JSONB `?`, `?|`, `?&` operators all contain one. The adapter uses a
  real SQL scanner rather than a regex for this reason.
- A pooled connection breaks read-then-write atomicity. Inside a transaction, use the
  executor the adapter hands you — a stray top-level `db.run()` takes a *different*
  pooled client and runs outside the transaction.

## Connected but not working

`list_integrations` reporting `connected: true` means only that a credential is stored —
a token row exists, or a cookie bundle has at least one live cookie. It does not mean the
credential still works. Common gaps:

| What is stored | What is wrong |
|---|---|
| A valid token | The grant lacks a scope the tool needs. Reconnect after fixing scopes |
| A token with no refresh token | It works until it expires, then fails with `Token expired and no refresh_token stored`. Add the provider's offline-access scope and reconnect |
| A cookie bundle with one live cookie | The *session* cookie expired and only a long-lived one remains. Recapture |
| A token for the wrong instance | A self-hosted connection missing `instanceUrl` fails the curl proxy with 502 and sends tools to the cloud. Reconnect through the instance prompt |
| A revoked token | Revoking the app at the provider does not notify the workbench. Disconnect and reconnect |

Disconnecting deletes only the local row — no provider-side revocation is attempted, so
clearing a bad state locally does not invalidate the token at the provider.

For the audit trail behind a failing tool, `audit_log` carries one row per execution with
the integration, tool, success flag and error, including the executions that never
reached a handler. A `SAFEPARSE_ERROR` row there means a plugin's schema is malformed and
that tool ran with unvalidated arguments and no defaults applied — see
[Executing tools](executing-tools.md).
