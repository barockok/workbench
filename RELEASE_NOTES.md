# a-workbench v0.23.2

_2026-08-14_

Headline: **API key verification is now O(1) — indexed SHA-256 lookup replaces a full-table bcrypt scan.**

## Performance

- **`verifyApiKey` — indexed lookup via `api_key_sha`.** Every `/mcp` request previously scanned every row in `users` and ran `bcrypt.compareSync` against each hash. At 100 users this blocked the event loop for about 2.8 seconds per request. The MCP handshake needs two requests, so a cold connect cost about 9.2 seconds on staging. A new `api_key_sha` column stores a SHA-256 of each key. An index on that column makes lookup a single `SELECT WHERE api_key_sha = ?`. The old bcrypt path is kept as a fallback for legacy rows (minted before this version) and is removed automatically on first successful verify.

  SHA-256 (no work factor) is the right choice for this column: keys are `crypto.randomBytes(32)`, server-minted, never user-chosen. 256 bits of entropy makes a preimage attack on the stored digest infeasible.

  Schema migration runs automatically at startup (`ALTER TABLE users ADD COLUMN api_key_sha TEXT` + partial index). No manual step is needed. OAuth Bearer and session JWT callers are not affected — they verify via signature, not a DB scan.

## Fixes

- **`resolve.ts`: missing `await` on `verifyApiKey`.** The caller did not await the async function. It received a Promise object, which is always truthy. The system may have accepted any API key header before this fix. The `await` is now present and auth is correctly enforced.

## Commits

- `perf(auth): index api key lookup instead of bcrypt-scanning all users` (64cf524)

**Full diff:** https://github.com/barockok/workbench/compare/v0.23.1...v0.23.2
