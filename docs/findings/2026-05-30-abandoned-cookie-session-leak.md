# Finding: abandoned cookie login sessions leak chromium + tmpdir

**Date:** 2026-05-30
**Area:** `packages/server/src/auth/cookie.ts`

## What

`startCookieSession` spawns a headless chromium process and a temp `userDataDir`
(`mkdtempSync`), and registers the session in the in-memory `sessions` Map. The
process + tmpdir are only ever freed by `closeCookieSession` (SIGKILL + `rm`).

There is **no TTL and no idle reaper**. If a user gets a CDP login URL but never
finishes login (closes the tab, walks away), the session sits in the Map with:

- a live headless chromium process, and
- a temp `userDataDir` on disk,

until `closeCookieSession` is explicitly called or the server restarts.

## Why it matters

- Correctness is safe: with no cookies captured, `hasValidCookies` stays false, so
  `execute_tool` keeps returning `NOT_CONNECTED` (guard at `mcp/meta-tools.ts:62`)
  and `createContext` throws `NOT_CONNECTED` before any HTTP call
  (`plugins/context.ts:104-107`). Double-gated.
- But each abandoned login is a **resource leak**: one orphaned chromium process
  and one temp dir per abandonment. Over time this exhausts memory / file handles /
  disk on the server host.

## Resolution

Closed by the MCP-initiated-connect design
(`docs/superpowers/specs/2026-05-30-mcp-initiated-connect-design.md`, §4): every
cookie session gets an `expiresAt` (default 10 min) and a `setInterval` reaper
calls `closeCookieSession` on expiry, plus an immediate reap on
`wait_for_connection` timeout.
