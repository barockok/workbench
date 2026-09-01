# Jot deploy via tar.gz upload — design

_2026-06-09_

## Summary

Reframe `deploy_jot` from a single MCP call carrying an inline `files[]` array into a
two-phase upload: the tool validates metadata and returns a single-use upload URL; the
agent packages the artifact as a `.tar.gz` and uploads it; the server streams,
extracts, validates, and atomically publishes the content under `/jots/<name>/`.

This removes the need to stuff file contents (base64 for binaries) through the MCP
JSON-RPC channel, which bloats token usage and is awkward for multi-file or binary
artifacts. The agent already has a shell, so it tars the directory and `curl`s it.

This is a **hard replacement** of the inline-files contract: `deploy_jot` no longer
accepts `files[]`. Any agent or doc using the old shape must move to the upload flow.

## Goals

- `deploy_jot` initiates a deploy and returns an upload URL + capability token.
- Agent packages a directory as `.tar.gz` and uploads it in one shell step.
- Server extracts safely (no traversal, no symlink escape, bounded size/count) and
  publishes atomically, leaving any existing jot untouched on failure.
- Validation that can fail early (name, ownership, access) fails at `deploy_jot` time,
  before the agent spends effort tarring.

## Non-goals

- Raising the size budget (stays 5 MiB decompressed).
- Backward compatibility with the inline `files[]` shape (intentionally dropped).
- Resumable/multipart uploads, progress streaming, or chunking.
- Changing jot serving, sandboxing, password gating, naming, or ownership rules.

## Flow

```
agent → deploy_jot({ name, access, password? })           # MCP tool
     ← { uploadUrl, token, expiresAt, maxBytes }

agent → tar czf - -C <dir> . \
          | curl --data-binary @- \
                 -H 'Content-Type: application/gzip' \
                 <uploadUrl>

server (POST /j/upload/:token):
   consume token  → pending deploy { owner, name, access, passwordHash }
   stream req.raw → gunzip → tar-stream → tmp dir   (guards applied per entry)
   commitJotDir(...) → write manifest + atomic swap into /jots/<name>/
     ← { name, access, url }
```

## Components

### `jots/pending.ts` (new)

In-memory store of pending deploys, keyed by an opaque random token.

- `mint({ owner, name, access, passwordHash }): { token, expiresAt }`
  - token: `crypto.randomBytes(32).toString("hex")` (unguessable, not a UUID).
  - records `createdAt`, `expiresAt = now + JOTS_UPLOAD_TTL_SECONDS`.
- `consume(token): PendingDeploy | null`
  - single-use: deletes the entry on read; returns null if missing or expired.
- TTL: `JOTS_UPLOAD_TTL_SECONDS` (default 300). Lazy-expire on `consume` plus a
  periodic reaper (mirrors `auth/connections.ts` reaper) so abandoned tokens don't
  accumulate.

`PendingDeploy = { owner: string; name: string; access: "public" | "password"; passwordHash?: string; expiresAt: number }`.

### `jots/extract.ts` (new)

Stream an uploaded gzip tarball into a fresh tmp directory, applying safety guards.
Signature: `extractTarGzToDir(src: Readable, destDir: string): Promise<{ fileCount: number; bytes: number }>` — throws a typed `JotExtractError` on any violation.

Pipeline: `src → zlib.createGunzip() → tar-stream.extract()`.

Per-entry guards:
- **Path:** run `header.name` through existing `safeRelPath` — reject absolute, `..`,
  NUL, empty, and the reserved manifest name. Reject → `INVALID_PATH`.
- **Type:** allow only `file` and `directory`. Reject `symlink`, `link` (hardlink),
  `character-device`, `block-device`, `fifo`, etc. → `UNSUPPORTED_ENTRY`.
  (Symlinks/hardlinks are the tar-slip escape vector.)
- **Decompressed size:** accumulate bytes as they stream; the moment the running total
  exceeds `JOTS_MAX_BYTES`, destroy the stream and reject → `TOO_LARGE`. Do not trust
  any declared size — enforce on the actual byte stream (zip-bomb guard).
- **File count:** counting regular files only; exceeding `JOTS_MAX_FILES` (1000) →
  `TOO_MANY_FILES`.
- **Empty:** zero regular files after a clean parse → `NO_FILES`.
- **Malformed:** a gunzip or tar parse error → `BAD_ARCHIVE`.

Writes regular files under `destDir` (creating parent dirs); directory entries create
dirs. `destDir` is a caller-provided tmp dir; on throw the caller removes it.

### `jots/store.ts` (changed)

Factor the existing manifest-write + atomic-swap tail of `deployJot` into:

- `commitJotDir({ name, owner, access, passwordHash, srcDir }): DeployResult`
  - re-checks ownership (`JOT_NAME_TAKEN`) just before swap (defensive; deploy_jot
    already checked at mint),
  - writes `jot.json` manifest into `srcDir`,
  - `rm -rf` the final dir then `rename(srcDir, finalDir)` (existing non-atomic-on-mac
    note preserved),
  - returns `{ name, access, url }` or `{ error }`.

The old `deployJot(files)` decode-and-write path is removed; its swap logic lives in
`commitJotDir`. `readManifest`, `listJots`, `deleteJot` unchanged.

### `jots/routes.ts` (changed)

- Register a content-type parser for `application/gzip` (and `application/octet-stream`)
  that hands the **raw request stream** to the handler rather than buffering — this both
  enables streaming extraction and sidesteps Fastify's default 1 MB `bodyLimit`. Guard
  with `hasContentTypeParser` like the existing urlencoded registration.
- `POST /j/upload/:token`:
  1. `consume(token)` → 404 if `null` (covers invalid, expired, already-used/replay).
  2. Make a tmp dir `${jotsRoot()}/<name>.up-<rand>`.
  3. `await extractTarGzToDir(stream, tmpDir)`; on `JotExtractError` remove tmp dir and
     map to status: `TOO_LARGE`/`TOO_MANY_FILES` → 413, `INVALID_PATH`/`UNSUPPORTED_ENTRY`/
     `BAD_ARCHIVE`/`NO_FILES` → 400.
  4. `commitJotDir({ ...pending, srcDir: tmpDir })`; map `JOT_NAME_TAKEN` → 409,
     `DEPLOY_FAILED` → 500.
  5. 200 `{ name, access, url }`.
- Route is token-gated only — no api-key/session. The token is the capability and is
  bound to the owner recorded at mint.
- Existing `/j/:name`, `/j/:name/__auth`, `/j/:name/*` routes unchanged.

### `mcp/meta-tools.ts` (changed)

`deploy_jot` input becomes `{ name, access, password? }` (no `files`). Handler:
- `access === "password" && !password` → `PASSWORD_REQUIRED`.
- `!isValidJotName(name)` → `INVALID_NAME`.
- existing jot owned by another user → `JOT_NAME_TAKEN`.
- `passwordHash = access === "password" ? hashPassword(password) : undefined`.
- `{ token, expiresAt } = mint({ owner: userId, name, access, passwordHash })`.
- return `{ uploadUrl: \`${SERVER_PUBLIC_URL}/j/upload/${token}\`, token, expiresAt, maxBytes: JOTS_MAX_BYTES }`.

Tool description updated to explain the two-phase flow and give the `tar czf - -C dir . | curl --data-binary @-` recipe. `list_jots` / `delete_jot` unchanged.

### Config (changed)

- `JOTS_UPLOAD_TTL_SECONDS` — default `300`.
- `JOTS_MAX_FILES` — default `1000`.
- `JOTS_MAX_BYTES` — unchanged, `5_242_880`.

### Dependencies

- add `tar-stream` and `@types/tar-stream` to `packages/server`.
- `zlib` (gunzip) is built-in.

## Error handling

| Phase | Condition | Result |
|---|---|---|
| deploy_jot | bad name | `INVALID_NAME` |
| deploy_jot | password access, no password | `PASSWORD_REQUIRED` |
| deploy_jot | name owned by another user | `JOT_NAME_TAKEN` |
| upload | token missing/expired/replayed | 404 |
| upload | entry path unsafe | 400 `INVALID_PATH` |
| upload | symlink/hardlink/device entry | 400 `UNSUPPORTED_ENTRY` |
| upload | decompressed > 5 MiB | 413 `TOO_LARGE` |
| upload | > 1000 files | 413 `TOO_MANY_FILES` |
| upload | not a valid gzip/tar | 400 `BAD_ARCHIVE` |
| upload | zero files | 400 `NO_FILES` |
| upload | name taken at commit | 409 `JOT_NAME_TAKEN` |
| upload | filesystem error | 500 `DEPLOY_FAILED` |

On any upload failure the existing published jot (if any) is untouched — extraction
goes to a tmp dir and only a successful extract reaches the swap. The token is consumed
at receipt regardless; a failed upload requires a fresh `deploy_jot`.

## Security

- Upload token: 32 random bytes, single-use, 5-min TTL, bound to owner at mint. It is a
  capability — possession authorizes exactly one upload to one jot name. No api-key
  needed (consistent with the connect magic-link model).
- Extraction guards (path, entry-type, size, count) defend against tar-slip, symlink
  escape, and zip bombs. Size is enforced on the live byte stream, not declared sizes.
- Serving is unchanged: sandbox CSP (opaque origin), manifest never served, password
  cookie token still bound to name + current password hash (v0.8.1).
- The raw-stream body parser is scoped to the gzip content types; it does not change
  parsing for other routes.

## Testing

- `pending`: mint returns token + expiry; `consume` is single-use (second read null);
  expired token reads null.
- `extract`: happy path (files + nested dirs); traversal entry rejected; symlink entry
  rejected; oversize aborts mid-stream (`TOO_LARGE`); > max files (`TOO_MANY_FILES`);
  malformed gzip (`BAD_ARCHIVE`); empty archive (`NO_FILES`).
- upload route: valid token + tarball → 200 and the jot serves; bad/expired token → 404;
  replayed token → 404; oversize tarball → 413.
- `deploy_jot`: returns `uploadUrl`/`token`/`expiresAt`/`maxBytes`; `JOT_NAME_TAKEN`;
  `PASSWORD_REQUIRED`; `INVALID_NAME`.
- Migrate existing jot route/store tests off `deployJot(files)` — seed published jots via
  `commitJotDir` (write a tmp dir) or via the upload path.

## Rollout

- Breaking change to the `deploy_jot` MCP contract. Bump minor (next: v0.9.0).
- Update `docs/architecture.md` meta-tools table and `docs/how-to-use.md` jot section to
  describe the upload flow.
