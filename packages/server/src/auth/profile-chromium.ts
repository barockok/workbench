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

async function pollJson(
  url: string,
  attempts = 40,
  intervalMs = 100,
  abort?: () => Error | null
): Promise<unknown> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const stop = abort?.();
    if (stop) throw stop;
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
  // Capture stderr so a launch failure (missing lib, crashed renderer, unwritable
  // profile dir, OOM) surfaces as a real reason instead of an opaque CDP timeout.
  const proc = spawn(execPath, args, { stdio: ["ignore", "ignore", "pipe"], detached: false });

  let stderrTail = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let spawnErr: Error | null = null;
  proc.on("error", (e) => { spawnErr = e; });
  proc.on("exit", (code, signal) => { exit = { code, signal }; });

  // If chromium died before/while we poll, fail fast with the captured reason
  // rather than burning the full poll budget on a process that's already gone.
  const launchFailure = (): Error | null => {
    if (spawnErr) return new Error(`chromium failed to spawn (${execPath}): ${spawnErr.message}`);
    if (exit) {
      const how = exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
      return new Error(`chromium exited (${how}) before DevTools came up. stderr: ${stderrTail.trim() || "(empty)"}`);
    }
    return null;
  };

  try {
    await pollJson(`http://127.0.0.1:${remotePort}/json/version`, 40, 100, launchFailure);
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
  } catch (e) {
    // Don't leak a half-alive chromium when startup fails. Prefer the concrete
    // launch failure (exit code + stderr) over the generic poll-timeout error.
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    throw launchFailure() ?? e;
  }
}
