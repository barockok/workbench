# Per-User Browser Profile (persistent capture session) — Design

**Date:** 2026-06-08
**Status:** Approved (design)
**Area:** `packages/server/src/auth/cookie.ts`, `config.ts`, `api/routes.ts`, portal

## Goal

Workbench manages a **persistent per-user browser session**. Today every cookie-auth `connect` spawns a throwaway Chromium with a fresh `mkdtemp` profile and deletes it on close, so the user re-logs-in for every plugin. Instead, the capture browser should open the **user's persistent profile** — if they've logged into a site/IdP before, that session is still there, so they aren't asked to log in again.

A direct consequence (not special-cased): two cookie plugins that share an identity provider reuse the same logged-in session. Connect plugin A (logs into the IdP), later connect plugin B (same IdP) → B's login is already satisfied.

This is **not** provider-specific (Google is just one example) and does **not** bypass any provider's IP/bot defenses — it only persists and reuses whatever session the user established.

## Non-goals (v1)

- General agent-driven browser tools (navigate/click/extract). Auth substrate only.
- Changing the cookie capture model, `ctx.http` replay, or the per-integration encrypted cookie store. **All unchanged.**
- Cross-**user** sharing. Profiles are strictly per-user.

## Core change

`startCookieSession` launches Chromium with `--user-data-dir=<persistent per-user profile>` instead of a throwaway dir, and `closeCookieSession` **keeps** the profile (only stops the process + the proxy-auth socket).

### Profile store
- Path: `${BROWSER_PROFILES_DIR}/<userId>/` — new env `BROWSER_PROFILES_DIR`, default `<dirname(DATABASE_URL)>/browser-profiles` (i.e. on the persistent data volume next to `tokens.db`).
- Created on first use, `0700`. One directory per user, reused across all that user's cookie-auth connects.
- Holds Chromium's full state (cookies, localStorage, etc.) — i.e. the user's live web sessions.

### Connect flow (unchanged except the profile)
1. `connect(integration)` → `startCookieSession(userId, integration, loginUrl, …)`.
2. Chromium launches against the **user's** profile (not empty). Prior logins persist.
3. User completes only what's new (e.g. authorize the new app); IdP logins they've already done are skipped.
4. Capture, per-integration cookie store, `ctx.http` replay: **unchanged**.

## Concurrency (single-writer per profile)

Chromium cannot run two processes against the same `user-data-dir` — concurrent use corrupts the profile. Therefore: **at most one active capture browser per user at a time.**

- Track active profile use per `userId` (e.g. a `Set<userId>` of in-flight sessions, or derive from the existing `sessions` map).
- `startCookieSession` checks first: if the user already has an active capture session, reject with a clear error (`BROWSER_SESSION_BUSY` — "A browser session is already active for this user. Finish or cancel it first.").
- Released when the session ends (`captureCookies` completion, `closeCookieSession`, cancel, or reaper timeout).
- Sequential connects are unaffected — the process is gone, the profile is on disk, the next launch reuses it.

## Profile reset

A user-facing way to wipe their profile (logout-everywhere / fix a corrupted profile / support).

- `resetBrowserProfile(userId)` in `cookie.ts`: refuse if a capture session is active for the user (else it would delete an in-use dir); otherwise `rm -rf` the profile dir.
- Endpoint: `POST /api/browser-session/reset` (authed; per-user, not per-integration). Returns `{ success }` or `409` if busy.
- Portal: a **"Reset browser session"** action at the account level (next to the API-key panel — it's per-user, not per-integration). Confirm dialog ("logs you out of all sites in the capture browser").

## Security

The profile contains **all** of the user's web sessions in Chromium's store (cookies plaintext at rest), a larger blast radius than the per-integration encrypted store. Mitigations:
- Strictly per-user directory, `0700`.
- On the same persistent volume as `tokens.db` (deployment is responsible for volume encryption).
- Never shared across users; path keyed by `userId` only (no user-supplied path components → no traversal).
- Reset endpoint lets a user purge it.

Accepted consciously: profile cookies are not app-encrypted (Chromium owns the store). This matches how any browser persists sessions; the protection is filesystem isolation + volume encryption.

## Files touched

- `packages/server/src/config.ts` — add `BROWSER_PROFILES_DIR` (default derived from `DATABASE_URL` dir).
- `packages/server/src/auth/cookie.ts` —
  - `startCookieSession`: resolve per-user profile dir, `mkdir -p` `0700`, launch with it; per-user single-writer guard.
  - `closeCookieSession`: stop process + `authWs`; **do not** remove the profile dir; release the per-user guard.
  - `resetBrowserProfile(userId)`: guarded `rm -rf`.
- `packages/server/src/api/routes.ts` — `POST /api/browser-session/reset`.
- `packages/portal/src/…` — account-level "Reset browser session" control + `api.ts` client fn.

## Testing

- Profile path: per-user, derived from `BROWSER_PROFILES_DIR`; no traversal from `userId`.
- `startCookieSession` spawns Chromium with the **persistent per-user** `--user-data-dir` (not `mkdtemp`).
- `closeCookieSession` does **not** delete the profile dir (does stop proc + authWs).
- Single-writer: a second concurrent `startCookieSession` for the same user errors `BROWSER_SESSION_BUSY`; a different user is unaffected; after close, the same user can start again.
- `resetBrowserProfile`: wipes the dir; refuses while a session is active (`409`).
- Route: reset is authed (401 without), returns success / 409-busy.

## Rollout

- Backwards compatible: existing per-integration cookie stores keep working. First connect after upgrade creates the profile; subsequent connects reuse it.
- Existing in-flight ephemeral behavior simply becomes persistent; no migration needed.
