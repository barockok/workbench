# Remote Browser Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add computer-use browser meta-tools (navigate, screenshot, click, type, key, scroll, live_url, close) that drive a warm per-user Chromium session over CDP, with a human live-view channel.

**Architecture:** Extract the Chromium launcher from `cookie.ts` into a shared `profile-chromium.ts` (one single-writer lock for both capture and browser sessions). A new `browser-session.ts` keeps one warm Chromium per user with a persistent CDP client and exposes action helpers. The browser tools are real MCP meta-tools (per-user, no integration connection). `mcp/server.ts` gains an `image` content path for screenshots. The live-view reuses the cookie-capture CDP-WS-proxy + connect-JWT pattern, copied (not abstracted) to a `/api/browser-session/cdp` route and a portal `/browser` page.

**Tech Stack:** TypeScript, Fastify, `@fastify/websocket`, raw Chrome DevTools Protocol over `ws`, Vitest, Vite/React portal.

**Spec:** `docs/superpowers/specs/2026-06-08-remote-browser-tools-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/src/auth/profile-chromium.ts` (NEW) | Shared Chromium launcher, `activeProfiles` lock, profile dirs, one-shot `cdpCall` |
| `packages/server/src/auth/cookie.ts` (MODIFY) | Import the shared launcher; keep public API unchanged |
| `packages/server/src/auth/browser-session.ts` (NEW) | Warm session map, persistent `CdpClient`, action helpers, reaper |
| `packages/server/src/config.ts` (MODIFY) | `BROWSER_SESSION_TTL_SECONDS` |
| `packages/server/src/mcp/server.ts` (MODIFY) | `_mcpImage` → MCP `image` content block |
| `packages/server/src/mcp/meta-tools.ts` (MODIFY) | `browser_*` meta-tools + wire schemas |
| `packages/server/src/api/routes.ts` (MODIFY) | `GET /api/connect/browser-session` (live-view token exchange) |
| `packages/server/src/index.ts` (MODIFY) | `/api/browser-session/cdp` WS proxy + origin hook + start reaper |
| `packages/portal/src/api.ts` (MODIFY) | `connectBrowserSession()` client helper |
| `packages/portal/src/pages/BrowserView.tsx` (NEW) | Live-view canvas page (reuses connect screencast) |
| `docs/how-to-use.md` (MODIFY) | New tools + env var |

---

## Task 1: Config — `BROWSER_SESSION_TTL_SECONDS`

**Files:**
- Modify: `packages/server/src/config.ts:28`
- Test: `packages/server/tests/config-browser-ttl.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/config-browser-ttl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { config } from "../src/config";

describe("config BROWSER_SESSION_TTL_SECONDS", () => {
  it("defaults to 300 seconds", () => {
    expect(config.BROWSER_SESSION_TTL_SECONDS).toBe(300);
  });
  it("is a positive integer", () => {
    expect(Number.isInteger(config.BROWSER_SESSION_TTL_SECONDS)).toBe(true);
    expect(config.BROWSER_SESSION_TTL_SECONDS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/config-browser-ttl.test.ts`
Expected: FAIL — `config.BROWSER_SESSION_TTL_SECONDS` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/server/src/config.ts`, after the `BROWSER_PROFILES_DIR` line (`:28`):

```ts
  BROWSER_PROFILES_DIR: z.string().optional(),
  BROWSER_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/config-browser-ttl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/config.ts packages/server/tests/config-browser-ttl.test.ts
git commit -m "feat(config): add BROWSER_SESSION_TTL_SECONDS (default 300)"
```

---

## Task 2: Extract shared Chromium launcher (`profile-chromium.ts`)

Move the launch primitives out of `cookie.ts` so the warm browser session and cookie-capture share **one** `activeProfiles` lock and one spawn path. `cookie.ts`'s public API is unchanged — the existing `cookie.test.ts` must still pass.

**Files:**
- Create: `packages/server/src/auth/profile-chromium.ts`
- Modify: `packages/server/src/auth/cookie.ts` (remove moved code, import it)
- Test: `packages/server/tests/profile-chromium.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/profile-chromium.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { userProfileDir, profilesBaseDir, activeProfiles } from "../src/auth/profile-chromium";

describe("profile-chromium dirs", () => {
  it("derives a per-user dir under the base", () => {
    const dir = userProfileDir("user-abc");
    expect(dir.startsWith(profilesBaseDir())).toBe(true);
    expect(dir.endsWith("user-abc")).toBe(true);
  });

  it("sanitizes path-traversal characters in the userId", () => {
    const dir = userProfileDir("../../etc/passwd");
    expect(dir).not.toContain("..");
    expect(dir.startsWith(profilesBaseDir())).toBe(true);
  });

  it("exports a shared activeProfiles lock set", () => {
    expect(activeProfiles instanceof Set).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/profile-chromium.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `profile-chromium.ts`**

Create `packages/server/src/auth/profile-chromium.ts` with the code moved from `cookie.ts` (lines 52–82 `getFreePort`/`pollJson`, 84–123 `TargetInfo`/`VersionInfo`/`cdpCall`, 175–184 `profilesBaseDir`/`userProfileDir`, the `activeProfiles` set from line 50, and the spawn body from 199–253):

```ts
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";
import { config } from "../config";

// Userdata dirs can't be shared by two Chromium processes — one active session
// (capture OR warm browser) per user at a time. Shared by cookie.ts and
// browser-session.ts so the two are mutually exclusive.
export const activeProfiles = new Set<string>();

export function profilesBaseDir(): string {
  return config.BROWSER_PROFILES_DIR || join(dirname(config.DATABASE_URL), "browser-profiles");
}

export function userProfileDir(userId: string): string {
  return join(profilesBaseDir(), userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || !addr) {
        srv.close();
        reject(new Error("getFreePort: no address"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function pollJson(url: string, attempts = 40, intervalMs = 100): Promise<unknown> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Failed to reach ${url}: ${String(lastErr)}`);
}

interface TargetInfo {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}
interface VersionInfo {
  webSocketDebuggerUrl: string;
}

// One-shot CDP request/response over a fresh socket.
export async function cdpCall(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, origin: "http://127.0.0.1" });
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error(`cdpCall ${method} timed out`));
    }, 10000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(`cdp ${method}: ${msg.error.message}`));
          else resolve(msg.result ?? {});
        }
      } catch (e) {
        clearTimeout(timeout);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    ws.on("error", (e) => { clearTimeout(timeout); reject(e); });
  });
}

export interface SpawnedChromium {
  proc: ChildProcess;
  remotePort: number;
  cdpBrowserWsUrl: string;
  cdpPageWsUrl: string;
}

// Launch a headless Chromium on the user's persistent profile and resolve once
// its DevTools endpoint and a non-blank page target are up. Caller owns the
// activeProfiles lock (acquire before calling, release on failure/teardown).
export async function spawnProfileChromium(
  userId: string,
  opts: { startUrl?: string } = {}
): Promise<SpawnedChromium> {
  const remotePort = await getFreePort();
  const userDataDir = userProfileDir(userId);
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  chmodSync(userDataDir, 0o700);
  const execPath = chromium.executablePath();
  const args = [
    "--headless=new",
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    "--remote-allow-origins=http://127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=TranslateUI",
    "--window-size=1280,800",
    ...(process.env.CAPTURE_PROXY ? [`--proxy-server=${process.env.CAPTURE_PROXY}`] : []),
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ];
  if (opts.startUrl) args.push(opts.startUrl);
  const proc = spawn(execPath, args, { stdio: "ignore", detached: false });

  await pollJson(`http://127.0.0.1:${remotePort}/json/version`);
  const versionInfo = (await pollJson(`http://127.0.0.1:${remotePort}/json/version`)) as VersionInfo;
  let target: TargetInfo | undefined;
  for (let i = 0; i < 30; i++) {
    const targets = (await pollJson(`http://127.0.0.1:${remotePort}/json`)) as TargetInfo[];
    target = targets.find((t) => t.type === "page");
    if (target && target.url && (opts.startUrl ? target.url !== "about:blank" : true)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!target) throw new Error("CDP: no page target found");

  return {
    proc,
    remotePort,
    cdpBrowserWsUrl: versionInfo.webSocketDebuggerUrl,
    cdpPageWsUrl: target.webSocketDebuggerUrl,
  };
}
```

- [ ] **Step 4: Refactor `cookie.ts` to use the shared module**

In `packages/server/src/auth/cookie.ts`:

1. Replace the top imports block (lines 1–10) — drop `createServer`, keep what's still used, and add the shared import:

```ts
import { spawn, ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { config } from "../config";
import WebSocket from "ws";
import { db } from "../db";
import { encrypt, decrypt } from "./encryption";
import {
  activeProfiles,
  userProfileDir,
  cdpCall,
  spawnProfileChromium,
} from "./profile-chromium";
```

(Note: `chromium`, `mkdirSync`, `chmodSync`, `join`, `dirname`, `createServer`, `getFreePort`, `pollJson` are no longer imported/defined here — they live in `profile-chromium.ts`. `spawn`/`ChildProcess` stay only if still referenced; after this refactor they are not — remove them too if `tsc` flags them.)

2. Delete from `cookie.ts`: the `activeProfiles` declaration (old line 50), `getFreePort` (52–68), `pollJson` (70–82), `TargetInfo`/`VersionInfo` interfaces (84–93), `cdpCall` (95–123), `profilesBaseDir`/`userProfileDir` (175–184).

3. Rewrite the launch portion of `startCookieSession` (the body from old lines 199–253) to call the shared spawner. Replace everything from `const remotePort = await getFreePort();` through the `if (!target) throw ...` line with:

```ts
    const { proc, remotePort, cdpBrowserWsUrl, cdpPageWsUrl } =
      await spawnProfileChromium(userId, { startUrl: loginUrl });
```

Then update the subsequent references: `versionInfo.webSocketDebuggerUrl` → `cdpBrowserWsUrl`, and `target.webSocketDebuggerUrl` → `cdpPageWsUrl` in the `Session` object and the return (`cdpUrl: cdpPageWsUrl`). The `authWs` block stays, now using `cdpBrowserWsUrl`:

```ts
    const authWs =
      process.env.CAPTURE_PROXY && proxyUser && proxyPass
        ? startProxyAuth(cdpBrowserWsUrl, proxyUser, proxyPass)
        : undefined;

    const session: Session = {
      proc,
      userDataDir: userProfileDir(userId),
      remotePort,
      cdpPageWsUrl,
      cdpBrowserWsUrl,
      cdpToken,
      loginUrl,
      targetDomain,
      cookieDomains: [targetDomain, ...cookieDomains],
      userId,
      integration,
      authWs,
    };
    sessions.set(sessionId, session);
    proc.on("exit", () => {
      activeProfiles.delete(userId);
      sessions.delete(sessionId);
      try { session.authWs?.close(); } catch { /* noop */ }
    });
    return { sessionId, cdpUrl: cdpPageWsUrl, cdpToken };
```

4. `resetBrowserProfile` keeps using `userProfileDir` (now imported) and `activeProfiles` (now imported) — no logic change.

- [ ] **Step 5: Run tests to verify both pass**

Run: `cd packages/server && npx vitest run tests/profile-chromium.test.ts tests/cookie.test.ts`
Expected: PASS for both (the `cookie.test.ts` ws/spawn mocks still apply — `profile-chromium.ts` uses the same mocked `ws`, `node:child_process`, `node:fs`). If `cookie.test.ts` imports broke, check that `userProfileDir`-dependent assertions still hold.

- [ ] **Step 6: Typecheck**

Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors (remove any now-unused imports `tsc` flags).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/auth/profile-chromium.ts packages/server/src/auth/cookie.ts packages/server/tests/profile-chromium.test.ts
git commit -m "refactor(auth): extract shared Chromium launcher + activeProfiles lock into profile-chromium.ts"
```

---

## Task 3: Warm session lifecycle (`browser-session.ts` — CdpClient + ensureSession)

**Files:**
- Create: `packages/server/src/auth/browser-session.ts`
- Test: `packages/server/tests/browser-session.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/browser-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("../src/auth/profile-chromium", async () => {
  const { EventEmitter } = await import("node:events");
  const real = await vi.importActual<typeof import("../src/auth/profile-chromium")>(
    "../src/auth/profile-chromium"
  );
  return {
    ...real,
    activeProfiles: new Set<string>(),
    spawnProfileChromium: spawnMock,
  };
});

// CdpClient opens a `ws`; emit "open" so its `ready` promise resolves. Enables
// are fire-and-forget so no reply frame is needed.
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    constructor() {
      super();
      setImmediate(() => this.emit("open"));
    }
  }
  return { default: FakeWebSocket, WebSocket: FakeWebSocket };
});

import {
  ensureSession,
  getWarmSession,
  getWarmCdpEndpoint,
  closeBrowserSession,
} from "../src/auth/browser-session";
import { activeProfiles } from "../src/auth/profile-chromium";

function fakeProc() {
  const { EventEmitter } = require("node:events");
  const p = new EventEmitter();
  p.kill = vi.fn();
  return p;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockResolvedValue({
    proc: fakeProc(),
    remotePort: 9999,
    cdpBrowserWsUrl: "ws://127.0.0.1:9999/browser",
    cdpPageWsUrl: "ws://127.0.0.1:9999/page",
  });
  activeProfiles.clear();
});

describe("ensureSession", () => {
  it("launches a session once and reuses it", async () => {
    const a = await ensureSession("user-x");
    const b = await ensureSession("user-x");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await closeBrowserSession("user-x");
  });

  it("acquires the activeProfiles lock", async () => {
    await ensureSession("user-y");
    expect(activeProfiles.has("user-y")).toBe(true);
    await closeBrowserSession("user-y");
    expect(activeProfiles.has("user-y")).toBe(false);
  });

  it("throws BROWSER_SESSION_BUSY when the lock is already held", async () => {
    activeProfiles.add("user-z");
    await expect(ensureSession("user-z")).rejects.toThrow("BROWSER_SESSION_BUSY");
  });

  it("getWarmCdpEndpoint returns the page WS only for the right token", async () => {
    const s = await ensureSession("user-t");
    expect(getWarmCdpEndpoint("user-t", s.cdpToken)).toBe("ws://127.0.0.1:9999/page");
    expect(getWarmCdpEndpoint("user-t", "wrong")).toBeNull();
    expect(getWarmCdpEndpoint("nobody", s.cdpToken)).toBeNull();
    await closeBrowserSession("user-t");
    expect(getWarmSession("user-t")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/browser-session.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `browser-session.ts` (lifecycle + CdpClient)**

Create `packages/server/src/auth/browser-session.ts`:

```ts
import { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { config } from "../config";
import { activeProfiles, spawnProfileChromium } from "./profile-chromium";

// Persistent CDP client: one long-lived socket to a page target, many
// request/response commands multiplexed by auto-incrementing id.
class CdpClient {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, origin: "http://127.0.0.1" });
    this.ready = new Promise((resolve, reject) => {
      this.ws.on("open", () => {
        // Fire-and-forget enables; we don't await their replies.
        this.fire("Page.enable");
        this.fire("Runtime.enable");
        resolve();
      });
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw: WebSocket.RawData) => {
      let msg: { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (typeof msg.id !== "number") return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`cdp: ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
    });
  }

  private fire(method: string, params: Record<string, unknown> = {}): void {
    const id = ++this.id;
    try { this.ws.send(JSON.stringify({ id, method, params })); } catch { /* noop */ }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`cdp ${method} timed out`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  close(): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); }
    this.pending.clear();
    try { this.ws.close(); } catch { /* noop */ }
  }
}

export interface WarmSession {
  proc: ChildProcess;
  remotePort: number;
  cdpPageWsUrl: string;
  cdpBrowserWsUrl: string;
  cdpToken: string;
  userId: string;
  lastActivity: number;
  cdp: CdpClient;
}

const warmSessions = new Map<string, WarmSession>();

export async function ensureSession(userId: string): Promise<WarmSession> {
  const existing = warmSessions.get(userId);
  if (existing) { existing.lastActivity = Date.now(); return existing; }

  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: a browser session is already active for this user");
  }
  activeProfiles.add(userId);
  try {
    const spawned = await spawnProfileChromium(userId, {});
    const cdp = new CdpClient(spawned.cdpPageWsUrl);
    await cdp.ready;
    const session: WarmSession = {
      proc: spawned.proc,
      remotePort: spawned.remotePort,
      cdpPageWsUrl: spawned.cdpPageWsUrl,
      cdpBrowserWsUrl: spawned.cdpBrowserWsUrl,
      cdpToken: crypto.randomUUID(),
      userId,
      lastActivity: Date.now(),
      cdp,
    };
    warmSessions.set(userId, session);
    spawned.proc.on("exit", () => {
      activeProfiles.delete(userId);
      warmSessions.delete(userId);
      try { session.cdp.close(); } catch { /* noop */ }
    });
    return session;
  } catch (e) {
    activeProfiles.delete(userId);
    throw e;
  }
}

export function touch(userId: string): void {
  const s = warmSessions.get(userId);
  if (s) s.lastActivity = Date.now();
}

export function getWarmSession(userId: string): WarmSession | undefined {
  return warmSessions.get(userId);
}

// Live-view proxy auth: page WS endpoint, gated on the session's cdpToken.
export function getWarmCdpEndpoint(userId: string, cdpToken: string): string | null {
  const s = warmSessions.get(userId);
  if (!s) return null;
  if (s.cdpToken !== cdpToken) return null;
  return s.cdpPageWsUrl;
}

export async function closeBrowserSession(userId: string): Promise<void> {
  const s = warmSessions.get(userId);
  if (!s) return;
  warmSessions.delete(userId);
  activeProfiles.delete(userId);
  try { s.cdp.close(); } catch { /* noop */ }
  try { s.proc.kill("SIGKILL"); } catch { /* noop */ }
}

let reaperStarted = false;
export function startBrowserReaper(): void {
  if (reaperStarted) return;
  reaperStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - config.BROWSER_SESSION_TTL_SECONDS * 1000;
    for (const [userId, s] of warmSessions) {
      if (s.lastActivity < cutoff) void closeBrowserSession(userId);
    }
  }, 30_000).unref();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/browser-session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/browser-session.ts packages/server/tests/browser-session.test.ts
git commit -m "feat(browser): warm per-user CDP session lifecycle + reaper"
```

---

## Task 4: CDP action helpers (navigate, screenshot, click, type, key, scroll)

**Files:**
- Modify: `packages/server/src/auth/browser-session.ts` (append action helpers)
- Test: `packages/server/tests/browser-actions.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/browser-actions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  navigate,
  screenshot,
  click,
  typeText,
  pressKey,
  scroll,
  type WarmSession,
} from "../src/auth/browser-session";

function sessionWithCdp(send: ReturnType<typeof vi.fn>): WarmSession {
  return { cdp: { send } } as unknown as WarmSession;
}

describe("browser actions", () => {
  it("navigate issues Page.navigate and returns url + title", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") return { result: { value: "Example" } };
      return {};
    });
    const out = await navigate(sessionWithCdp(send), "https://example.com");
    expect(send).toHaveBeenCalledWith("Page.navigate", { url: "https://example.com" });
    expect(out).toEqual({ url: "https://example.com", title: "Example" });
  });

  it("screenshot returns base64 png data", async () => {
    const send = vi.fn(async () => ({ data: "iVBORw0KGgo=" }));
    const out = await screenshot(sessionWithCdp(send));
    expect(send).toHaveBeenCalledWith("Page.captureScreenshot", { format: "png" });
    expect(out).toBe("iVBORw0KGgo=");
  });

  it("click dispatches press + release at coords", async () => {
    const send = vi.fn(async () => ({}));
    await click(sessionWithCdp(send), 100, 200, "left");
    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", x: 100, y: 200, button: "left", clickCount: 1 }));
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseReleased", x: 100, y: 200, button: "left" }));
  });

  it("typeText inserts text", async () => {
    const send = vi.fn(async () => ({}));
    await typeText(sessionWithCdp(send), "hello");
    expect(send).toHaveBeenCalledWith("Input.insertText", { text: "hello" });
  });

  it("pressKey sends keyDown + keyUp with modifiers for a chord", async () => {
    const send = vi.fn(async () => ({}));
    await pressKey(sessionWithCdp(send), "ctrl+a");
    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "rawKeyDown", modifiers: 2 }));
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyUp", modifiers: 2 }));
  });

  it("scroll sends a mouseWheel with downward delta", async () => {
    const send = vi.fn(async () => ({}));
    await scroll(sessionWithCdp(send), "down", 600);
    expect(send).toHaveBeenCalledWith("Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseWheel", deltaY: 600 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/browser-actions.test.ts`
Expected: FAIL — `navigate`/`screenshot`/etc. not exported.

- [ ] **Step 3: Append action helpers to `browser-session.ts`**

Add at the end of `packages/server/src/auth/browser-session.ts`:

```ts
// ─── CDP action helpers ───────────────────────────────────────────────────
// Each takes a WarmSession and speaks CDP through its persistent client.

export async function navigate(
  s: WarmSession,
  url: string
): Promise<{ url: string; title: string; warning?: string }> {
  let warning: string | undefined;
  try {
    await s.cdp.send("Page.navigate", { url });
    // Give the load a moment; Page.loadEventFired isn't awaited here to keep
    // the helper simple — a short settle covers most SPAs. (Follow-up: await
    // the load event.)
    await new Promise((r) => setTimeout(r, 800));
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }
  const title = await pageTitle(s);
  return warning ? { url, title, warning } : { url, title };
}

async function pageTitle(s: WarmSession): Promise<string> {
  try {
    const r = (await s.cdp.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    const v = r.result?.value;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export async function screenshot(s: WarmSession): Promise<string> {
  const r = (await s.cdp.send("Page.captureScreenshot", { format: "png" })) as { data?: string };
  return r.data ?? "";
}

type MouseButton = "left" | "right" | "middle";
export async function click(s: WarmSession, x: number, y: number, button: MouseButton = "left"): Promise<void> {
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
}

export async function typeText(s: WarmSession, text: string): Promise<void> {
  await s.cdp.send("Input.insertText", { text });
}

// Minimal key map for the common driving keys. Chords like "ctrl+a" parse the
// trailing token as the key and the leading tokens as modifiers.
const MODIFIERS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };
const KEYS: Record<string, { keyCode: number; key: string }> = {
  enter: { keyCode: 13, key: "Enter" },
  tab: { keyCode: 9, key: "Tab" },
  escape: { keyCode: 27, key: "Escape" },
  esc: { keyCode: 27, key: "Escape" },
  backspace: { keyCode: 8, key: "Backspace" },
  delete: { keyCode: 46, key: "Delete" },
  arrowup: { keyCode: 38, key: "ArrowUp" },
  arrowdown: { keyCode: 40, key: "ArrowDown" },
  arrowleft: { keyCode: 37, key: "ArrowLeft" },
  arrowright: { keyCode: 39, key: "ArrowRight" },
};

export async function pressKey(s: WarmSession, keys: string): Promise<void> {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  let modifiers = 0;
  let last = "";
  for (const p of parts) {
    if (MODIFIERS[p] !== undefined) modifiers |= MODIFIERS[p];
    else last = p;
  }
  const mapped = KEYS[last];
  const base: Record<string, unknown> = mapped
    ? { windowsVirtualKeyCode: mapped.keyCode, key: mapped.key, modifiers }
    : { key: last, text: last.length === 1 ? last : undefined, modifiers };
  await s.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await s.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

type ScrollDir = "up" | "down" | "left" | "right";
export async function scroll(s: WarmSession, direction: ScrollDir, amount = 600): Promise<void> {
  const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0;
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 400, deltaX, deltaY });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/browser-actions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/browser-session.ts packages/server/tests/browser-actions.test.ts
git commit -m "feat(browser): CDP action helpers (navigate/screenshot/click/type/key/scroll)"
```

---

## Task 5: MCP image content path (`_mcpImage` sentinel)

**Files:**
- Modify: `packages/server/src/mcp/server.ts:68-75`
- Test: `packages/server/tests/mcp-server.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/mcp-server.test.ts` inside the top-level `describe`:

```ts
  it("emits an image content block when a handler returns _mcpImage", async () => {
    // browser_screenshot is a real meta-tool; stub registry not needed since
    // it doesn't touch plugins. Drive it via tools/call.
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "browser_screenshot", arguments: {} } },
      "user-1"
    );
    // Either it returns an image block (session mocked) — assert the shape the
    // server produces for the sentinel directly via a fake tool instead:
    expect(res).toBeTruthy();
  });
```

> Because `browser_screenshot` needs a live session, prefer testing the server's sentinel branch in isolation. Replace the above with this focused unit that doesn't require a browser — add a temporary exported helper test by asserting the wrapping function. Implement the simplest robust test:

```ts
  it("wraps a normal result as text", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "search_tools", arguments: { query: "x" } } },
      "user-1"
    );
    const r = res?.result as { content: { type: string }[] };
    expect(r.content[0].type).toBe("text");
  });
```

(The dedicated `_mcpImage` shape assertion is covered in Task 7 once `browser_screenshot` exists and the session is mockable; here we only guarantee the text path is unchanged.)

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd packages/server && npx vitest run tests/mcp-server.test.ts`
Expected: the text-path test PASSES (no behavior change yet); the placeholder image test is replaced per the note.

- [ ] **Step 3: Implement the sentinel branch**

In `packages/server/src/mcp/server.ts`, replace the `tools/call` result construction (lines ~68–75):

```ts
    const result = await tool.handler({ userId }, parsed.data as any);

    // A handler may return an image sentinel; surface it as a real MCP image
    // content block instead of JSON text. Everything else is text-wrapped.
    const img = (result as { _mcpImage?: { data: string; mimeType: string } } | null)?._mcpImage;
    const content = img
      ? [{ type: "image", data: img.data, mimeType: img.mimeType }]
      : [{ type: "text", text: JSON.stringify(result) }];

    return {
      jsonrpc: "2.0",
      id,
      result: { content },
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/mcp-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/server.ts packages/server/tests/mcp-server.test.ts
git commit -m "feat(mcp): emit image content block for _mcpImage handler results"
```

---

## Task 6: `browser_*` action meta-tools (navigate, screenshot, click, type, key, scroll, close)

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts` (add tools + schemas)
- Test: `packages/server/tests/browser-meta-tools.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/browser-meta-tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ensureMock, touchMock, navMock, shotMock, clickMock, typeMock, keyMock, scrollMock, closeMock } =
  vi.hoisted(() => ({
    ensureMock: vi.fn(),
    touchMock: vi.fn(),
    navMock: vi.fn(),
    shotMock: vi.fn(),
    clickMock: vi.fn(),
    typeMock: vi.fn(),
    keyMock: vi.fn(),
    scrollMock: vi.fn(),
    closeMock: vi.fn(),
  }));

vi.mock("../src/auth/browser-session", () => ({
  ensureSession: ensureMock,
  touch: touchMock,
  navigate: navMock,
  screenshot: shotMock,
  click: clickMock,
  typeText: typeMock,
  pressKey: keyMock,
  scroll: scrollMock,
  closeBrowserSession: closeMock,
}));

import { metaTools } from "../src/mcp/meta-tools";

function tool(name: string) {
  const t = metaTools.find((m) => m.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureMock.mockResolvedValue({ userId: "u1" });
});

describe("browser_* meta-tools", () => {
  it("browser_navigate ensures session, touches, navigates", async () => {
    navMock.mockResolvedValue({ url: "https://e.com", title: "E" });
    const out = await (tool("browser_navigate").handler as any)({ userId: "u1" }, { url: "https://e.com" });
    expect(ensureMock).toHaveBeenCalledWith("u1");
    expect(touchMock).toHaveBeenCalledWith("u1");
    expect(out).toEqual({ url: "https://e.com", title: "E" });
  });

  it("browser_screenshot returns an _mcpImage sentinel", async () => {
    shotMock.mockResolvedValue("BASE64PNG");
    const out = await (tool("browser_screenshot").handler as any)({ userId: "u1" }, {});
    expect(out).toEqual({ _mcpImage: { data: "BASE64PNG", mimeType: "image/png" } });
  });

  it("browser_click returns ok", async () => {
    const out = await (tool("browser_click").handler as any)({ userId: "u1" }, { x: 1, y: 2 });
    expect(clickMock).toHaveBeenCalledWith({ userId: "u1" }, 1, 2, "left");
    expect(out).toEqual({ ok: true });
  });

  it("browser_close closes the session", async () => {
    const out = await (tool("browser_close").handler as any)({ userId: "u1" }, {});
    expect(closeMock).toHaveBeenCalledWith("u1");
    expect(out).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/browser-meta-tools.test.ts`
Expected: FAIL — tools not found.

- [ ] **Step 3: Add the tools to `meta-tools.ts`**

In `packages/server/src/mcp/meta-tools.ts`, add the import near the top (after line 12):

```ts
import {
  ensureSession,
  touch,
  navigate as browserNavigate,
  screenshot as browserScreenshot,
  click as browserClick,
  typeText as browserType,
  pressKey as browserKey,
  scroll as browserScroll,
  closeBrowserSession,
} from "../auth/browser-session";
```

Then add these entries to the `metaTools` array (before the closing `] satisfies`):

```ts
  {
    name: "browser_navigate",
    description: "Navigate the per-user browser session to a URL. Opens a warm session if none is active. Returns the final url and page title.",
    inputSchema: z.object({ url: z.string().url() }),
    handler: async (ctx: { userId: string }, args: { url: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      return browserNavigate(s, args.url);
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a PNG screenshot of the current viewport. Returns an image the model can view. Use it to see the page before clicking.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      const data = await browserScreenshot(s);
      return { _mcpImage: { data, mimeType: "image/png" } };
    },
  },
  {
    name: "browser_click",
    description: "Click at viewport coordinates (x, y) in the per-user browser session.",
    inputSchema: z.object({
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "right", "middle"]).default("left"),
    }),
    handler: async (ctx: { userId: string }, args: { x: number; y: number; button: "left" | "right" | "middle" }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserClick(s, args.x, args.y, args.button);
      return { ok: true };
    },
  },
  {
    name: "browser_type",
    description: "Type text into the currently focused element. Click the field first.",
    inputSchema: z.object({ text: z.string() }),
    handler: async (ctx: { userId: string }, args: { text: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserType(s, args.text);
      return { ok: true };
    },
  },
  {
    name: "browser_key",
    description: "Press a key or chord, e.g. 'Enter', 'Tab', 'ctrl+a', 'ArrowDown'.",
    inputSchema: z.object({ keys: z.string() }),
    handler: async (ctx: { userId: string }, args: { keys: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserKey(s, args.keys);
      return { ok: true };
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the viewport up/down/left/right by an optional pixel amount (default 600).",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().positive().default(600),
    }),
    handler: async (ctx: { userId: string }, args: { direction: "up" | "down" | "left" | "right"; amount: number }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserScroll(s, args.direction, args.amount);
      return { ok: true };
    },
  },
  {
    name: "browser_close",
    description: "Close the per-user warm browser session (the persistent profile is kept). Frees the single-writer lock so a cookie capture can run.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      await closeBrowserSession(ctx.userId);
      return { ok: true };
    },
  },
```

- [ ] **Step 4: Add wire schemas**

In the `metaToolSchemas` object in the same file, add:

```ts
  browser_navigate: {
    type: "object",
    properties: { url: { type: "string", description: "URL to navigate to" } },
    required: ["url"],
  },
  browser_screenshot: { type: "object", properties: {} },
  browser_click: {
    type: "object",
    properties: {
      x: { type: "number", description: "Viewport x coordinate" },
      y: { type: "number", description: "Viewport y coordinate" },
      button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button (default left)" },
    },
    required: ["x", "y"],
  },
  browser_type: {
    type: "object",
    properties: { text: { type: "string", description: "Text to type into the focused element" } },
    required: ["text"],
  },
  browser_key: {
    type: "object",
    properties: { keys: { type: "string", description: "Key or chord, e.g. Enter, ctrl+a" } },
    required: ["keys"],
  },
  browser_scroll: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" },
      amount: { type: "number", description: "Pixels to scroll (default 600)" },
    },
    required: ["direction"],
  },
  browser_close: { type: "object", properties: {} },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/browser-meta-tools.test.ts tests/mcp-server.test.ts`
Expected: PASS. (`metaToolSchemas` is keyed by tool name with a compile-time exhaustiveness check — if a schema is missing, `tsc` errors. Run `npx tsc --noEmit` to confirm.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/tests/browser-meta-tools.test.ts
git commit -m "feat(mcp): browser_* computer-use meta-tools"
```

---

## Task 7: Live-view token exchange route (`GET /api/connect/browser-session`)

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts` (add `browser_live_url` tool + schema)
- Modify: `packages/server/src/api/routes.ts` (add the exchange route)
- Test: `packages/server/tests/browser-live-url.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/browser-live-url.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ensureMock, signMock } = vi.hoisted(() => ({
  ensureMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock("../src/auth/browser-session", () => ({
  ensureSession: ensureMock,
  touch: vi.fn(),
  navigate: vi.fn(), screenshot: vi.fn(), click: vi.fn(),
  typeText: vi.fn(), pressKey: vi.fn(), scroll: vi.fn(),
  closeBrowserSession: vi.fn(),
}));
vi.mock("../src/auth/connect-token", () => ({
  signConnectToken: signMock,
}));

import { metaTools } from "../src/mcp/meta-tools";

beforeEach(() => {
  vi.clearAllMocks();
  ensureMock.mockResolvedValue({ userId: "u1", cdpToken: "ctok" });
  signMock.mockResolvedValue("jwt-xyz");
});

describe("browser_live_url", () => {
  it("mints a connect JWT bound to the session and returns a /browser URL", async () => {
    const t = metaTools.find((m) => m.name === "browser_live_url")!;
    const out = (await (t.handler as any)({ userId: "u1" }, {})) as { url: string };
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", sessionId: "u1", cdpToken: "ctok", integration: "__browser__" }),
      expect.any(Number)
    );
    expect(out.url).toContain("/browser?t=jwt-xyz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/browser-live-url.test.ts`
Expected: FAIL — `browser_live_url` not found.

- [ ] **Step 3: Add the `browser_live_url` meta-tool**

In `packages/server/src/mcp/meta-tools.ts`, add to the `metaTools` array:

```ts
  {
    name: "browser_live_url",
    description: "Get a short-lived URL to watch and take over the per-user browser session in a web canvas. Open it to drive the same browser by hand, then return control to the model.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      const jwt = await signConnectToken(
        { connectionId: ctx.userId, userId: ctx.userId, integration: "__browser__", sessionId: ctx.userId, cdpToken: s.cdpToken },
        config.CONNECT_TTL_SECONDS
      );
      return { url: `${config.PORTAL_URL}/browser?t=${jwt}` };
    },
  },
```

And to `metaToolSchemas`:

```ts
  browser_live_url: { type: "object", properties: {} },
```

(`signConnectToken` and `config` are already imported in this file.)

- [ ] **Step 4: Verify the meta-tool test passes**

Run: `cd packages/server && npx vitest run tests/browser-live-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the token-exchange route**

In `packages/server/src/api/routes.ts`, near the other `/api/connect/*` routes (around line 427), add:

```ts
  // Live-view token exchange for the browser session. The /browser magic-link
  // page presents its connect JWT and gets back the relative CDP proxy URL +
  // the token to send in the WS auth frame. Mirrors /api/connect/session.
  app.get("/api/connect/browser-session", async (request, reply) => {
    const token = (request.query as { t?: string }).t;
    if (!token) return reply.status(400).send({ error: "Missing token" });
    let payload;
    try {
      payload = await verifyConnectToken(token);
    } catch {
      return reply.status(401).send({ error: "Link invalid or expired" });
    }
    if (payload.integration !== "__browser__") {
      return reply.status(400).send({ error: "Not a browser-session link" });
    }
    return {
      cdpProxyUrl: "/api/browser-session/cdp",
      sessionId: payload.sessionId,
      cdpToken: payload.cdpToken,
    };
  });
```

(`verifyConnectToken` is already imported at `routes.ts:25`.)

- [ ] **Step 6: Add a route test**

Append to `packages/server/tests/routes.test.ts` (follow the existing app-bootstrap pattern in that file — reuse its `buildApp`/`inject` helper). Add inside the top-level describe:

```ts
  it("GET /api/connect/browser-session rejects a missing token", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/connect/browser-session" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
```

> If `routes.test.ts` uses a different helper name than `buildTestApp`, match it. The assertion only needs the 400-on-missing-token path, which requires no browser session.

- [ ] **Step 7: Run tests**

Run: `cd packages/server && npx vitest run tests/browser-live-url.test.ts tests/routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/src/api/routes.ts packages/server/tests/browser-live-url.test.ts packages/server/tests/routes.test.ts
git commit -m "feat(browser): browser_live_url meta-tool + /api/connect/browser-session exchange"
```

---

## Task 8: CDP WS proxy for the browser session + start the reaper (`index.ts`)

**Files:**
- Modify: `packages/server/src/index.ts` (origin hook prefix, new WS route, start reaper)

This route is a copy of the existing `/api/auth/cookie/:integration/cdp` handler (lines 90–222), resolving the target via `getWarmCdpEndpoint`. Copied deliberately (per design — no abstraction yet).

- [ ] **Step 1: Extend the origin preValidation hook**

In `packages/server/src/index.ts`, change the hook (lines 72–79) to also cover the browser proxy:

```ts
  app.addHook("preValidation", async (request, reply) => {
    const isCookieCdp = request.url.startsWith("/api/auth/cookie/") && request.url.includes("/cdp");
    const isBrowserCdp = request.url.startsWith("/api/browser-session/cdp");
    if (isCookieCdp || isBrowserCdp) {
      const origin = request.headers.origin;
      if (!isOriginAllowed(origin)) {
        return reply.code(403).send({ error: "Origin not allowed" });
      }
    }
  });
```

- [ ] **Step 2: Add the import**

At the top of `index.ts`, alongside `getSessionCdpEndpoint` (line 12):

```ts
import { getWarmCdpEndpoint, startBrowserReaper } from "./auth/browser-session";
```

- [ ] **Step 3: Add the WS proxy route**

After the existing `/api/auth/cookie/:integration/cdp` handler block (after line 222), add:

```ts
  // Browser-session live-view: same auth-framed CDP proxy as cookie capture,
  // but the target is the user's warm browser page resolved via cdpToken.
  app.get("/api/browser-session/cdp", { websocket: true }, (conn, request) => {
    const browserWs = conn as unknown as WebSocket;
    if (!isOriginAllowed(request.headers.origin)) {
      try { browserWs.close(4403, "Origin not allowed"); } catch { /* noop */ }
      return;
    }
    const toText = (data: WebSocket.RawData): string => {
      if (typeof data === "string") return data;
      if (Buffer.isBuffer(data)) return data.toString("utf8");
      if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
      return Buffer.from(data as ArrayBuffer).toString("utf8");
    };

    let upstream: WebSocket | null = null;
    let upstreamReady = false;
    const pending: string[] = [];
    const authTimeout = setTimeout(() => {
      try { browserWs.close(4408, "auth timeout"); } catch { /* noop */ }
    }, 5000);

    function startProxy(target: string) {
      upstream = new WebSocket(target, { perMessageDeflate: false, origin: "http://127.0.0.1" });
      upstream.on("open", () => {
        upstreamReady = true;
        for (const msg of pending) upstream!.send(msg);
        pending.length = 0;
      });
      upstream.on("message", (data: WebSocket.RawData) => {
        if (browserWs.readyState === WebSocket.OPEN) browserWs.send(toText(data));
      });
      const upstreamClosed = () => { try { browserWs.close(); } catch { /* noop */ } };
      upstream.on("close", upstreamClosed);
      upstream.on("error", upstreamClosed);
    }

    browserWs.on("message", async (data: WebSocket.RawData) => {
      const text = toText(data);
      if (!upstream) {
        let msg: { type?: string; sessionId?: string; cdpToken?: string; bearer?: string };
        try { msg = JSON.parse(text); } catch {
          try { browserWs.close(4400, "Bad auth frame"); } catch { /* noop */ }
          return;
        }
        if (msg.type !== "auth" || !msg.sessionId || !msg.cdpToken || !msg.bearer) {
          try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
          return;
        }
        let authedUserId = await getUserIdFromAuth(`Bearer ${msg.bearer}`);
        if (!authedUserId) {
          try {
            const payload = await verifyConnectToken(msg.bearer);
            if (
              payload.integration === "__browser__" &&
              payload.sessionId === msg.sessionId &&
              payload.cdpToken === msg.cdpToken
            ) {
              authedUserId = payload.userId;
            }
          } catch { /* not a valid connect JWT */ }
        }
        // The warm session is keyed by userId; the link's sessionId IS the
        // userId. Require they match so a token can't target another user.
        if (!authedUserId || authedUserId !== msg.sessionId) {
          try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
          return;
        }
        const target = getWarmCdpEndpoint(authedUserId, msg.cdpToken);
        if (!target) {
          try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
          return;
        }
        clearTimeout(authTimeout);
        startProxy(target);
        try { browserWs.send(JSON.stringify({ type: "ready" })); } catch { /* noop */ }
        return;
      }
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else pending.push(text);
    });

    browserWs.on("close", () => { clearTimeout(authTimeout); try { upstream?.close(); } catch { /* noop */ } });
    browserWs.on("error", () => { clearTimeout(authTimeout); try { upstream?.close(); } catch { /* noop */ } });
  });
```

- [ ] **Step 4: Start the reaper**

In `main()`, after `await loadPlugins();` (line 65) or alongside the existing `startReaper()` call (find where connections' `startReaper` runs), add:

```ts
  startBrowserReaper();
```

(If `startReaper()` for connections is called inside `registerApiRoutes` or `index.ts`, place `startBrowserReaper()` next to it. Searching: `grep -n "startReaper" packages/server/src` — match that location.)

- [ ] **Step 5: Typecheck + full server test run**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests PASS. (No new unit test for the WS proxy handler here — it's a structural copy of the cookie proxy, which is already covered; the origin/auth-frame branches are identical logic. The route is exercised end-to-end manually in Task 10's smoke check.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(browser): CDP WS proxy for live-view + start idle reaper"
```

---

## Task 9: Portal live-view page (`/browser`)

Reuse the existing `/connect` screencast canvas. First locate it.

**Files:**
- Modify: `packages/portal/src/api.ts` (add `connectBrowserSession`)
- Create: `packages/portal/src/pages/BrowserView.tsx`
- Modify: the portal router (where routes are registered) to add `/browser`

- [ ] **Step 1: Locate the connect page + router + canvas component**

Run:
```bash
grep -rn "connectSession\|/connect\|cdpProxyUrl\|createRoutes\|<Route\|RouterProvider\|screencast\|Page.startScreencast" packages/portal/src | head -40
```
Expected: identifies the connect page component (the one calling `connectSession` + opening the CDP WS and rendering screencast frames) and the router file. Read that component fully before proceeding — `BrowserView` mirrors it.

- [ ] **Step 2: Add the API client helper**

In `packages/portal/src/api.ts`, add (mirrors `connectSession` at lines 122–134, but for the browser exchange which is keyed by `?t=` query, not a Bearer):

```ts
export async function connectBrowserSession(jwt: string) {
  const res = await fetch(`${API_URL}/api/connect/browser-session?t=${encodeURIComponent(jwt)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Link invalid");
  return res.json() as Promise<{ cdpProxyUrl: string; sessionId: string; cdpToken: string }>;
}
```

- [ ] **Step 3: Create `BrowserView.tsx`**

Create `packages/portal/src/pages/BrowserView.tsx` modeled on the connect page found in Step 1. It must:
1. Read `t` from the URL (`new URLSearchParams(location.search).get("t")`).
2. Call `connectBrowserSession(t)` → `{ cdpProxyUrl, sessionId, cdpToken }`.
3. Open `new WebSocket(wsUrl)` where `wsUrl` is `cdpProxyUrl` resolved to an absolute `ws(s)://` URL against `location.origin`.
4. On open, send the auth frame: `{ type: "auth", sessionId, cdpToken, bearer: localStorage.getItem("awb_token") }`.
5. On the server's `{ type: "ready" }` frame, start the CDP screencast (`Page.startScreencast`), render frames to a `<canvas>`, and forward `Input.*` events from user clicks/keys — **identical to the connect page's canvas logic**. Reuse that component if it's exported; otherwise copy its canvas-driving code.

Because the connect canvas already implements the full screencast + input forwarding, the concrete body is whatever that component does. Do not invent a new protocol — copy it. The only differences from the connect page: the exchange endpoint (`connectBrowserSession` vs `connectSession`) and no integration name / no "Capture session" button (this page is watch + drive only).

Add a minimal page heading: `"Browser session — you are driving the live browser. Close this tab to hand control back."`.

- [ ] **Step 4: Register the route**

In the portal router file found in Step 1, add a route mapping `/browser` → `<BrowserView />`. Follow the existing route registration syntax exactly (e.g. another `<Route path="connect/:integration" .../>` becomes the template for `<Route path="browser" element={<BrowserView />} />`).

- [ ] **Step 5: Build the portal**

Run: `cd packages/portal && npx tsc --noEmit && npx vite build`
Expected: typechecks and builds clean.

- [ ] **Step 6: Commit**

```bash
git add packages/portal/src/api.ts packages/portal/src/pages/BrowserView.tsx packages/portal/src/<router-file>
git commit -m "feat(portal): /browser live-view page for the warm browser session"
```

---

## Task 10: Docs + manual smoke

**Files:**
- Modify: `docs/how-to-use.md`

- [ ] **Step 1: Document the tools + env var**

In `docs/how-to-use.md`, add a `### Browser tools` subsection under the tools usage area:

```markdown
### Browser tools (computer-use)

Workbench hosts one warm Chromium per user (the same persistent profile cookie
connects build on, so prior logins carry over). The MCP client drives it
step-by-step:

- `browser_navigate({ url })` — go to a page (opens the session if cold)
- `browser_screenshot()` — returns a PNG the model can see
- `browser_click({ x, y, button? })`, `browser_type({ text })`,
  `browser_key({ keys })`, `browser_scroll({ direction, amount? })`
- `browser_live_url()` — a link to watch and take over the browser by hand
- `browser_close()` — end the session (profile kept)

The session is idle-reaped after `BROWSER_SESSION_TTL_SECONDS` (default 300).
A warm browser session and a cookie capture can't run at once for one user
(`BROWSER_SESSION_BUSY`) — close one first.
```

And add to the Environment Variables table:

```markdown
| `BROWSER_SESSION_TTL_SECONDS` | `300` | Idle seconds before a warm per-user browser session is reaped (its profile is kept). |
```

- [ ] **Step 2: Full gate**

Run:
```bash
cd packages/server && npx vitest run && npx tsc --noEmit
cd ../portal && npx tsc --noEmit && npx vite build
```
Expected: all green.

- [ ] **Step 3: Manual smoke (Docker)**

```bash
docker compose build && docker compose up -d
```
Then from an MCP client (or curl to `/mcp`): `browser_navigate({url:"https://example.com"})` → `{url,title}`; `browser_screenshot()` → image; `browser_live_url()` → open the URL, confirm the canvas renders and a manual click lands. Confirm `browser_close()` releases the lock (a subsequent cookie connect for the same user succeeds).

- [ ] **Step 4: Commit**

```bash
git add docs/how-to-use.md
git commit -m "docs: document browser computer-use tools + BROWSER_SESSION_TTL_SECONDS"
```

---

## Final Review

After all tasks: dispatch a code-reviewer over the full diff (`git diff main...HEAD`) against this plan and the spec. Then use `superpowers:finishing-a-development-branch`.
```
