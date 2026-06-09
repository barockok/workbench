# a-workbench v0.9.0

_2026-06-09_

Headline: **`deploy_jot` is now a tar.gz upload** — deploy a jot by uploading a gzip tarball to a returned URL instead of stuffing the whole file tree through the MCP call.

## ⚠️ Breaking change
- **`deploy_jot` no longer accepts `files[]`.** It now takes `{ name, access, password? }`, validates up front, and returns `{ uploadUrl, token, expiresAt, maxBytes }`. Package your site directory and upload it as a gzip tarball: `tar czf - -C <dir> . | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. Agents/clients still using the inline-`files[]` shape must switch to the two-step flow. The MCP wire schema is updated accordingly.

## Features
- **Two-phase jot deploy via tar.gz upload.** `deploy_jot` mints a single-use upload token (~5 min TTL, 256-bit, owner-bound server-side) and returns its URL. `POST /j/upload/:token` streams the archive through `gunzip → tar-stream` into a staging dir and publishes it atomically. This keeps large/binary/multi-file artifacts out of the MCP JSON-RPC channel.
- **Hardened extraction.** Each entry is validated: path-traversal/absolute/NUL/manifest names rejected (`safeRelPath`), only regular files and directories allowed (symlinks/hardlinks/devices rejected — no tar-slip escape), decompressed size capped mid-stream (≤5 MiB, zip-bomb-safe), and a ≤1000-file cap. A failed upload leaves any existing jot untouched.

## Notes
- New config: `JOTS_MAX_FILES` (default 1000), `JOTS_UPLOAD_TTL_SECONDS` (default 300). `JOTS_MAX_BYTES` unchanged (5 MiB decompressed). New dependency: `tar-stream`.
- Ownership/access/password are bound at `deploy_jot` time and cannot be overridden by the upload body. Serving is unchanged (sandboxed opaque-origin CSP; password-cookie binding from v0.8.1).
- Security review: clean (no findings). Tests: 409 passing (406 server + 3 shared).
- Docs updated: `architecture.md` (meta-tools row), `how-to-use.md` (Deploying a jot).
