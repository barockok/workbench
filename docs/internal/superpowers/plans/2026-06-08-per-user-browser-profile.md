# Per-User Browser Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cookie-auth capture browser use a persistent per-user Chromium profile so prior logins (any site/IdP) carry across plugin connects instead of starting from a blank profile every time.

**Architecture:** `startCookieSession` launches Chromium against `<BROWSER_PROFILES_DIR>/<userId>/` instead of a throwaway `mkdtemp` dir, and `closeCookieSession` keeps that dir. A per-user single-writer guard prevents two Chromium processes from sharing one profile dir. A reset endpoint + portal control wipe a user's profile. Capture, `ctx.http` replay, and the per-integration cookie store are unchanged.

**Tech Stack:** TypeScript, Fastify, Playwright/raw-CDP, Vitest, React (portal). Spec: `docs/superpowers/specs/2026-06-08-per-user-browser-profile-design.md`.

---

## File Structure

- `packages/server/src/config.ts` — add optional `BROWSER_PROFILES_DIR`.
- `packages/server/src/auth/cookie.ts` — profile path helper, persistent `--user-data-dir`, keep-on-close, single-writer guard, `resetBrowserProfile`.
- `packages/server/src/api/routes.ts` — `POST /api/browser-session/reset`.
- `packages/portal/src/api.ts` — `resetBrowserSession()` client.
- `packages/portal/src/components/BrowserSessionPanel.tsx` — account-level Reset control (new).
- `packages/portal/src/pages/Dashboard.tsx` — render the panel.
- `docs/how-to-use.md` — env table row.

Tests: `packages/server/tests/cookie.test.ts`, `packages/server/tests/routes.test.ts`.

---

### Task 1: `BROWSER_PROFILES_DIR` config

**Files:**
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add the optional env to the schema.** In `configSchema`, after the `OAUTH_ACCESS_TOKEN_TTL_SECONDS` line, add:

```ts
  BROWSER_PROFILES_DIR: z.string().optional(),
```

- [ ] **Step 2: Verify build.**

Run: `npm run build`
Expected: `Tasks: 4 successful`. (No test needed — config is consumed in Task 2 where it's tested.)

- [ ] **Step 3: Commit.**

```bash
git add packages/server/src/config.ts
git commit -m "feat(config): add optional BROWSER_PROFILES_DIR"
```

---

### Task 2: Profile path helper + persistent `--user-data-dir`

**Files:**
- Modify: `packages/server/src/auth/cookie.ts`
- Test: `packages/server/tests/cookie.test.ts`

Current `startCookieSession` (around line 179) does:
```ts
const userDataDir = mkdtempSync(join(tmpdir(), "awb-cookie-"));
```
and `closeCookieSession` (around line 333) deletes it. This task swaps the dir to a persistent per-user path. (Keep-on-close is Task 3.)

- [ ] **Step 1: Write the failing test.** In `cookie.test.ts`, add inside `describe("startCookieSession / captureCookies / closeCookieSession")`:

```ts
    it("launches Chromium with a persistent per-user profile dir (not mkdtemp)", async () => {
      spawnCalls.length = 0;
      mockFetchForStart();
      const { sessionId } = await startCookieSession("user-42", "test-integ", "https://example.com/login", "example.com");
      const args = spawnCalls.at(-1)!;
      const udd = args.find((a) => a.startsWith("--user-data-dir="))!;
      expect(udd).toContain("/user-42");        // keyed by userId
      expect(udd).not.toContain("awb-cookie-"); // not the old mkdtemp prefix
      await closeCookieSession(sessionId);
    });
```

- [ ] **Step 2: Mock `mkdirSync` in the fs mock.** In `cookie.test.ts`, the existing `vi.mock("node:fs", ...)` returns `{ ...actual, mkdtempSync: () => "/tmp/awb-cookie-test" }`. Change it to also stub `mkdirSync`:

```ts
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdtempSync: () => "/tmp/awb-cookie-test", mkdirSync: () => undefined };
});
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "persistent per-user"`
Expected: FAIL — `--user-data-dir` still contains `awb-cookie-` / mkdtemp path.

- [ ] **Step 4: Implement the path helper + use it.** In `cookie.ts`:

  a. Update the fs import (line 3) to add `mkdirSync`:
```ts
import { mkdtempSync, mkdirSync } from "node:fs";
```
  b. Extend the existing `node:path` import (line 6 is `import { join } from "node:path";`) to add `dirname`, and add the config import:
```ts
import { join, dirname } from "node:path";
import { config } from "../config";
```
  c. Add the helper above `startCookieSession`:
```ts
// Base dir holding one persistent Chromium profile per user. Defaults next to
// the SQLite DB (on the same persistent volume) when BROWSER_PROFILES_DIR unset.
function profilesBaseDir(): string {
  return config.BROWSER_PROFILES_DIR || join(dirname(config.DATABASE_URL), "browser-profiles");
}

// Per-user persistent profile dir. Keyed by userId only (no path traversal).
function userProfileDir(userId: string): string {
  return join(profilesBaseDir(), userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}
```
  d. In `startCookieSession`, replace the `mkdtempSync` line:
```ts
  const userDataDir = userProfileDir(userId);
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "persistent per-user"`
Expected: PASS.

- [ ] **Step 6: Run the full cookie suite (catch regressions in existing capture tests).**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add packages/server/src/auth/cookie.ts packages/server/tests/cookie.test.ts
git commit -m "feat(cookie-auth): launch capture browser with a persistent per-user profile"
```

---

### Task 3: Keep the profile on close

**Files:**
- Modify: `packages/server/src/auth/cookie.ts`
- Test: `packages/server/tests/cookie.test.ts`

`closeCookieSession` currently `rm`s `session.userDataDir`. With a persistent profile it must NOT delete it (only stop the process + the proxy-auth socket).

- [ ] **Step 1: Write the failing test.** Add inside the same describe block:

```ts
    it("closeCookieSession keeps the persistent profile (does not delete the dir)", async () => {
      const rmMod = await import("node:fs/promises");
      const rmSpy = vi.spyOn(rmMod, "rm");
      mockFetchForStart();
      const { sessionId } = await startCookieSession("user-keep", "test-integ", "https://example.com/login", "example.com");
      await closeCookieSession(sessionId);
      // it may rm temp things elsewhere, but never the user profile dir
      const removedProfile = rmSpy.mock.calls.some((c) => String(c[0]).includes("/user-keep"));
      expect(removedProfile).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "keeps the persistent profile"`
Expected: FAIL — `rm` is called with the profile dir.

- [ ] **Step 3: Remove the profile deletion.** In `cookie.ts` `closeCookieSession`, delete this line:
```ts
  await rm(session.userDataDir, { recursive: true, force: true }).catch(() => undefined);
```
Keep the `session.authWs?.close()` and `session.proc.kill("SIGKILL")` lines. If `rm` from `node:fs/promises` is now unused, leave the import (Task 5 reuses it for reset).

- [ ] **Step 4: Run test to verify it passes.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "keeps the persistent profile"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/auth/cookie.ts packages/server/tests/cookie.test.ts
git commit -m "feat(cookie-auth): persist profile across sessions (don't delete on close)"
```

---

### Task 4: Single-writer guard per user

**Files:**
- Modify: `packages/server/src/auth/cookie.ts`
- Test: `packages/server/tests/cookie.test.ts`

Two Chromium processes on one profile dir corrupt it. Allow at most one active capture session per user.

- [ ] **Step 1: Write the failing tests.** Add inside the describe block:

```ts
    it("rejects a second concurrent capture session for the same user", async () => {
      mockFetchForStart();
      const first = await startCookieSession("busy-user", "test-integ", "https://example.com/login", "example.com");
      await expect(
        startCookieSession("busy-user", "other-integ", "https://example.com/login", "example.com")
      ).rejects.toThrow(/BROWSER_SESSION_BUSY/);
      await closeCookieSession(first.sessionId);
      // after close the same user can start again
      const again = await startCookieSession("busy-user", "test-integ", "https://example.com/login", "example.com");
      expect(again.sessionId).toBeDefined();
      await closeCookieSession(again.sessionId);
    });

    it("allows concurrent capture sessions for different users", async () => {
      mockFetchForStart();
      const a = await startCookieSession("user-a", "test-integ", "https://example.com/login", "example.com");
      const b = await startCookieSession("user-b", "test-integ", "https://example.com/login", "example.com");
      expect(a.sessionId).not.toBe(b.sessionId);
      await closeCookieSession(a.sessionId);
      await closeCookieSession(b.sessionId);
    });
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "concurrent capture"`
Expected: FAIL — second start does not throw.

- [ ] **Step 3: Implement the guard.** In `cookie.ts`, near `const sessions = new Map(...)` (line 46) add:
```ts
// Userdata dirs can't be shared by two Chromium processes — one active capture
// session per user at a time.
const activeProfiles = new Set<string>();
```
  In `startCookieSession`, as the FIRST statements of the function body (before launching Chromium / allocating ports):
```ts
  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: a browser session is already active for this user");
  }
  activeProfiles.add(userId);
```
  Wrap the rest of the function body so the guard is released if launch fails. Simplest: change the existing logic so any throw after `activeProfiles.add` removes it. Add a `try` right after the `add` and on the existing throw paths. Concretely, replace the final `return { sessionId, cdpUrl: ..., cdpToken };` to keep the guard (it stays held while the session is open), and add a `catch` that releases:
```ts
  try {
    // ... existing body that allocates ports, spawns chromium, polls targets,
    //     builds the Session, sessions.set(...) ...
    return { sessionId, cdpUrl: target.webSocketDebuggerUrl, cdpToken };
  } catch (e) {
    activeProfiles.delete(userId);
    throw e;
  }
```
  In `closeCookieSession`, after retrieving `session` and before/after killing the proc, release the guard:
```ts
  activeProfiles.delete(session.userId);
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "concurrent capture"`
Expected: PASS.

- [ ] **Step 5: Run full cookie suite.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts`
Expected: all pass. (If a pre-existing test starts two sessions for the same hard-coded userId without closing the first, give them distinct userIds.)

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/auth/cookie.ts packages/server/tests/cookie.test.ts
git commit -m "feat(cookie-auth): single active capture session per user (BROWSER_SESSION_BUSY)"
```

---

### Task 5: `resetBrowserProfile(userId)`

**Files:**
- Modify: `packages/server/src/auth/cookie.ts`
- Test: `packages/server/tests/cookie.test.ts`

- [ ] **Step 1: Write the failing tests.** Add a new describe block in `cookie.test.ts`:

```ts
  describe("resetBrowserProfile", () => {
    it("wipes the user's profile dir", async () => {
      const rmMod = await import("node:fs/promises");
      const rmSpy = vi.spyOn(rmMod, "rm").mockResolvedValue(undefined as any);
      await resetBrowserProfile("reset-me");
      const wiped = rmSpy.mock.calls.some((c) => String(c[0]).includes("/reset-me"));
      expect(wiped).toBe(true);
    });

    it("refuses to reset while a capture session is active", async () => {
      mockFetchForStart();
      const s = await startCookieSession("active-reset", "test-integ", "https://example.com/login", "example.com");
      await expect(resetBrowserProfile("active-reset")).rejects.toThrow(/BROWSER_SESSION_BUSY/);
      await closeCookieSession(s.sessionId);
    });
  });
```
  Add `resetBrowserProfile` to the import list at the top of `cookie.test.ts`.

- [ ] **Step 2: Run to verify it fails.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "resetBrowserProfile"`
Expected: FAIL — `resetBrowserProfile is not a function`.

- [ ] **Step 3: Implement.** In `cookie.ts` add (near the other exports):
```ts
// Wipe a user's persistent browser profile (logout-everywhere / repair).
// Refuses while a capture session is active — would delete an in-use dir.
export async function resetBrowserProfile(userId: string): Promise<void> {
  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: finish or cancel the active browser session first");
  }
  await rm(userProfileDir(userId), { recursive: true, force: true }).catch(() => undefined);
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/cookie.test.ts -t "resetBrowserProfile"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/auth/cookie.ts packages/server/tests/cookie.test.ts
git commit -m "feat(cookie-auth): resetBrowserProfile to wipe a user's persistent profile"
```

---

### Task 6: `POST /api/browser-session/reset`

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/tests/routes.test.ts`

- [ ] **Step 1: Add `resetBrowserProfile` to the cookie mock.** In `routes.test.ts`, the `vi.mock("../src/auth/cookie", ...)` block — add:
```ts
  resetBrowserProfile: vi.fn(() => Promise.resolve()),
```

- [ ] **Step 2: Write the failing tests.** Add a new describe block in `routes.test.ts`:

```ts
  describe("POST /api/browser-session/reset", () => {
    const apiKey = { "x-workbench-api-key": "valid-api-key" };

    it("resets the caller's browser profile", async () => {
      const { resetBrowserProfile } = await import("../src/auth/cookie");
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/browser-session/reset", headers: apiKey });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
      expect(vi.mocked(resetBrowserProfile)).toHaveBeenCalledWith("user-1");
    });

    it("401s without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/browser-session/reset" });
      expect(res.statusCode).toBe(401);
    });

    it("409s when a session is busy", async () => {
      const { resetBrowserProfile } = await import("../src/auth/cookie");
      vi.mocked(resetBrowserProfile).mockRejectedValueOnce(new Error("BROWSER_SESSION_BUSY: x"));
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/browser-session/reset", headers: apiKey });
      expect(res.statusCode).toBe(409);
    });
  });
```

- [ ] **Step 3: Run to verify it fails.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/routes.test.ts -t "browser-session/reset"`
Expected: FAIL — route 404.

- [ ] **Step 4: Implement the route.** In `routes.ts`:
  a. Add `resetBrowserProfile` to the existing `import { ... } from "../auth/cookie";` block.
  b. Add the route (place it near the other `/api/integrations` / cookie routes):
```ts
  // Reset (wipe) the caller's persistent browser profile — logs them out of all
  // sites in the capture browser. Per-user, not per-integration.
  app.post("/api/browser-session/reset", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    try {
      await resetBrowserProfile(user.userId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("BROWSER_SESSION_BUSY")) {
        return reply.status(409).send({ error: "A browser session is active. Finish or cancel it first." });
      }
      return reply.status(400).send({ error: message });
    }
  });
```

- [ ] **Step 5: Run to verify it passes.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run tests/routes.test.ts -t "browser-session/reset"`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/api/routes.ts packages/server/tests/routes.test.ts
git commit -m "feat(api): POST /api/browser-session/reset to wipe a user's browser profile"
```

---

### Task 7: Portal — Reset browser session control

**Files:**
- Modify: `packages/portal/src/api.ts`
- Create: `packages/portal/src/components/BrowserSessionPanel.tsx`
- Modify: `packages/portal/src/pages/Dashboard.tsx`

No new server tests (covered by Task 6). Verify via `npm run build`.

- [ ] **Step 1: Add the API client fn.** In `packages/portal/src/api.ts`, after `revokeApiKey`:
```ts
export async function resetBrowserSession(): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/browser-session/reset`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || "Reset failed";
    throw new Error(msg);
  }
  return res.json();
}
```

- [ ] **Step 2: Create the panel component.** `packages/portal/src/components/BrowserSessionPanel.tsx`:
```tsx
import { useState } from "react";
import { resetBrowserSession } from "../api";

// Account-level control: wipe the user's persistent capture-browser profile
// (logs them out of every site in the capture browser).
export default function BrowserSessionPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onReset() {
    if (!window.confirm("Reset browser session? This logs you out of all sites in the capture browser.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await resetBrowserSession();
      setMsg({ ok: true, text: "Browser session reset." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="apikey-panel">
      <div className="apikey-head"><span>Browser session</span></div>
      <p className="integ-detail-desc">
        The capture browser remembers your logins across plugins. Reset to log out of everything and start fresh.
      </p>
      <button className="btn-disconnect" onClick={onReset} disabled={busy}>Reset browser session</button>
      {msg && <div className={msg.ok ? "session-transfer-ok" : "login-error"}>{msg.text}</div>}
    </div>
  );
}
```
(Reuses existing classes `apikey-panel`, `apikey-head`, `integ-detail-desc`, `btn-disconnect`, `session-transfer-ok`, `login-error`.)

- [ ] **Step 3: Render it in the Dashboard.** In `packages/portal/src/pages/Dashboard.tsx`:
  a. Add the import near the `ApiKeyPanel` import (line 6):
```tsx
import BrowserSessionPanel from "../components/BrowserSessionPanel";
```
  b. Render it right after `<ApiKeyPanel />` (line ~125):
```tsx
        <ApiKeyPanel />
        <BrowserSessionPanel />
```

- [ ] **Step 4: Build the portal.**

Run: `npm run build`
Expected: `Tasks: 4 successful`, portal builds (no TS errors).

- [ ] **Step 5: Commit.**

```bash
git add packages/portal/src/api.ts packages/portal/src/components/BrowserSessionPanel.tsx packages/portal/src/pages/Dashboard.tsx
git commit -m "feat(portal): Reset browser session control (account-level)"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/how-to-use.md`

- [ ] **Step 1: Add the env row.** In the Environment Variables table in `docs/how-to-use.md`, after the `CAPTURE_PROXY_USERNAME / _PASSWORD` row, add:
```
| `BROWSER_PROFILES_DIR` | `<data dir>/browser-profiles` | Where per-user persistent capture-browser profiles are stored. Each user gets one Chromium profile reused across cookie-auth connects, so prior logins (any site/IdP) carry over instead of starting blank. Defaults next to the SQLite DB. |
```

- [ ] **Step 2: Commit.**

```bash
git add docs/how-to-use.md
git commit -m "docs: document BROWSER_PROFILES_DIR (persistent per-user capture profile)"
```

---

### Task 9: Full verification

- [ ] **Step 1: Full server suite.**

Run: `cd packages/server && ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 NODE_ENV=test npx vitest run`
Expected: all pass.

- [ ] **Step 2: Strict build.**

Run: `npm run build`
Expected: `Tasks: 4 successful`, no `error TS`.

- [ ] **Step 3: Final review commit (if any cleanup).** Otherwise nothing to commit.

---

## Notes for the implementer

- This does **not** bypass any provider's IP/bot defenses — it only persists/reuses the user's own session. (Pairs with `CAPTURE_PROXY` and session import for in-cluster.)
- The capture flow, `ctx.http` replay, and per-integration cookie store are unchanged — do not touch them.
- `userId` is sanitized into the path (`[^a-zA-Z0-9_-] → _`) to prevent traversal; keep that.
- Profiles persist on the data volume; the deployment owns volume encryption.
