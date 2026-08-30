---
title: Jots file store
description: Deploy a self-contained static site from an agent and serve it at /j/<name>/, public or password-gated.
---

A jot is a static web artifact the workbench hosts for you: a report, a chart, a small
tool, a page an agent built. You deploy a directory as a gzip tarball and it is served
at `/j/<name>/`.

Jots are a built-in integration (`auth.type: "none"`), so they are always connected and
need no credential. They live in server source rather than the plugin directory, because
their handlers write to the filesystem — a capability the plugin context deliberately
does not expose.

## The three tools

| Tool | Does |
|---|---|
| `deploy_jot` | Validates the name and returns an upload URL plus a single-use token |
| `list_jots` | Lists **your** jots — name, access, url, updatedAt, newest first |
| `delete_jot` | Deletes a jot you own; `FORBIDDEN` for another owner, `NOT_FOUND` if absent |

## Deploying

Deployment is two steps: mint, then upload.

:::steps

### Call deploy_jot

```json
{ "executions": [ { "tool": "deploy_jot",
  "args": { "name": "release-report", "access": "public" } } ] }
```

```json
{
  "result": {
    "uploadUrl": "https://workbench.example.com/j/upload/9f2c…",
    "token": "9f2c…",
    "expiresAt": 1756400300000,
    "maxBytes": 5242880
  }
}
```

### Upload the tarball

Package the directory's *contents* — the archive root must be the site root — and POST
the gzip stream:

```bash
tar czf - -C ./site . \
  | curl --data-binary @- \
      -H 'Content-Type: application/gzip' \
      https://workbench.example.com/j/upload/9f2c…
```

### Open it

```
https://workbench.example.com/j/release-report/
```

`/j/release-report` without the trailing slash redirects to it. Directories fall back to
`index.html`.

:::

The upload replaces any previous deploy of that name wholesale — this is a publish, not
a merge.

## The guards, in order

`deploy_jot` checks three things before minting anything, and returns on the first
failure.

| Order | Error | Cause |
|---|---|---|
| 1 | `INVALID_NAME` | The name is not `^[a-z0-9][a-z0-9-]*$`, or is longer than 64 characters |
| 2 | `PASSWORD_REQUIRED` | `access: "password"` was requested without a `password` |
| 3 | `JOT_NAME_TAKEN` | The name exists and belongs to a different user |

> [!WARNING] Jot names are global and creator-locked
> There is no per-user namespace. `report` is one name across the whole server, owned by
> whoever deployed it first. The original owner can redeploy it freely; everyone else
> gets `JOT_NAME_TAKEN` and cannot overwrite or delete it. On a shared workbench, prefix
> your names.

## The upload token

The token returned by `deploy_jot` is **single use** and expires after
`JOTS_UPLOAD_TTL_SECONDS` (default 300). It carries the owner, the name, the access
mode, and — for a password jot — the already-hashed password. The password itself is
hashed at mint and never travels with the upload.

Because the token carries everything, the upload endpoint takes no other authentication.
It is the credential. A consumed or unknown token returns 404, and `expiresAt` is epoch
milliseconds.

Pending tokens are held in memory, not the database, so a server restart between the
mint and the upload invalidates the token. Call `deploy_jot` again.

## Upload failures

| Status | Body | Cause |
|---|---|---|
| 404 | — | Unknown or already-consumed token |
| 413 | `{"error":"TOO_LARGE"}` | Decompressed size over `JOTS_MAX_BYTES` |
| 413 | `{"error":"TOO_MANY_FILES"}` | More than `JOTS_MAX_FILES` entries |
| 400 | `{"error":"BAD_ARCHIVE"}` | Not a readable gzip tarball |
| 400 | `{"error":"NO_INDEX"}` | No `index.html` at the archive root |
| 409 | `{"error":"JOT_NAME_TAKEN"}` | The name was claimed between mint and upload |
| 500 | `{"error":"DEPLOY_FAILED"}` | The publish step failed |

`NO_INDEX` is the one that catches people. The archive root must contain `index.html`
directly — that is what `/j/<name>/` serves. Archiving the directory itself instead of
its contents produces `site/index.html` at the root and a rejected upload. Note the
`-C ./site .` in the command above: it is doing the work.

## Password-protected jots

```json
{ "executions": [ { "tool": "deploy_jot",
  "args": { "name": "internal-notes", "access": "password", "password": "…" } } ] }
```

A locked jot behaves differently by client:

- A **browser navigation** gets HTTP 200 and an unlock page. Submitting the password
  sets an httpOnly, `SameSite=Lax` cookie scoped to that jot, good for 30 days, and
  redirects into the site. Production deployments mark it `Secure`.
- Anything else — a `curl`, a `fetch` — gets **401 Unauthorized**.

A wrong password re-renders the unlock page with an error and 401.

This is access control for casual sharing, not a secrets store. Anyone with the URL and
the password reads the content.

## How jots are served

Every jot response carries a restrictive header set. The important one:

```
Content-Security-Policy: sandbox allow-scripts allow-forms
```

That puts each jot on an **opaque origin**. Scripts run, forms submit, but the page
cannot read the workbench's cookies or make credentialed same-origin requests to `/api`
or `/mcp`. Responses also carry `nosniff`, `X-Frame-Options: SAMEORIGIN`, and
`Cross-Origin-Resource-Policy: same-origin`.

> [!WARNING] A jot cannot fetch its own data files
> The opaque origin means same-origin `fetch` from inside a jot does not work. Pages
> must be **self-contained**: inline the data, or embed it as a data URI. Loading
> `data.json` alongside `index.html` at runtime will fail. This is the single most
> common surprise when deploying a page that worked locally.

Two more serving details:

- The internal manifest file is never served. A request for it returns **404**, not 403,
  so its existence is not confirmed.
- Path traversal out of the jot directory returns **403 Forbidden**.

## Limits and configuration

The defaults are stated in the tool's own description, but all four are configurable.

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `JOTS_DIR` | `<dirname of DATABASE_URL>/jots` | no | Where jot directories live |
| `JOTS_MAX_BYTES` | `5242880` (5 MiB) | no | Decompressed size cap |
| `JOTS_MAX_FILES` | `1000` | no | File-count cap, enforced during extraction |
| `JOTS_UPLOAD_TTL_SECONDS` | `300` | no | Lifetime of a mint token |

The size and file caps are enforced *while extracting*, not after, so a zip-bomb-shaped
archive is stopped partway rather than after filling the disk.

`JOTS_DIR` defaulting next to the database means jots and `tokens.db` share a volume by
default. On a small volume, point it somewhere with room.

## Listing and deleting

```json
{ "executions": [ { "tool": "list_jots", "args": {} } ] }
```

```json
{
  "result": {
    "jots": [
      { "name": "release-report", "access": "public",
        "url": "https://workbench.example.com/j/release-report/",
        "updatedAt": "2026-08-30T09:12:44.000Z" }
    ]
  }
}
```

Only your own jots are returned — there is no way to enumerate another user's, even
though the names share one namespace. In-flight staging directories are skipped.

```json
{ "executions": [ { "tool": "delete_jot", "args": { "name": "release-report" } } ] }
```

Returns `{"ok": true}`, or `{"error":"FORBIDDEN"}` / `{"error":"NOT_FOUND"}`. Deletion
is immediate and removes the directory; the name becomes available again.
