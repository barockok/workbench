import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";
import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export interface CookieData {
  domain: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  capturedAt: number;
}

interface Session {
  proc: ChildProcess;
  userDataDir: string;
  remotePort: number;
  // Raw Chromium DevTools Protocol page WS URL — what the portal proxies onto.
  cdpPageWsUrl: string;
  // Browser-level CDP WS URL, used for cookie capture.
  cdpBrowserWsUrl: string;
  // Short-lived random token gating the WS proxy for this session.
  cdpToken: string;
  loginUrl: string;
  targetDomain: string;
  cookieDomains: string[];
  userId: string;
  integration: string;
}

const sessions = new Map<string, Session>();

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

async function cdpCall(
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

export async function startCookieSession(
  userId: string,
  integration: string,
  loginUrl: string,
  targetDomain: string,
  cookieDomains: string[] = []
): Promise<{ sessionId: string; cdpUrl: string; cdpToken: string }> {
  const remotePort = await getFreePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "awb-cookie-"));
  // Reuse Playwright's chromium binary so we don't need a second install.
  const execPath = chromium.executablePath();
  const proc = spawn(
    execPath,
    [
      // `new` headless renders fully (and emits screencast frames) without
      // requiring a visible OS window. The portal canvas is what the user
      // sees — chromium itself never opens a window on the server host.
      "--headless=new",
      `--remote-debugging-port=${remotePort}`,
      `--user-data-dir=${userDataDir}`,
      // Allow our proxy to connect with origin=http://127.0.0.1. Newer
      // chromium does not treat `*` as a wildcard.
      "--remote-allow-origins=http://127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=TranslateUI",
      "--window-size=1280,800",
      loginUrl,
    ],
    { stdio: "ignore", detached: false }
  );

  // Wait for the devtools endpoint to come up.
  await pollJson(`http://127.0.0.1:${remotePort}/json/version`);
  const versionInfo = (await pollJson(`http://127.0.0.1:${remotePort}/json/version`)) as VersionInfo;
  // Poll page targets until our login URL is loaded.
  let target: TargetInfo | undefined;
  for (let i = 0; i < 30; i++) {
    const targets = (await pollJson(`http://127.0.0.1:${remotePort}/json`)) as TargetInfo[];
    target = targets.find((t) => t.type === "page");
    if (target && target.url && target.url !== "about:blank") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!target) throw new Error("CDP: no page target found");

  const sessionId = crypto.randomUUID();
  const cdpToken = crypto.randomUUID();

  sessions.set(sessionId, {
    proc,
    userDataDir,
    remotePort,
    cdpPageWsUrl: target.webSocketDebuggerUrl,
    cdpBrowserWsUrl: versionInfo.webSocketDebuggerUrl,
    cdpToken,
    loginUrl,
    targetDomain,
    cookieDomains: [targetDomain, ...cookieDomains],
    userId,
    integration,
  });

  return { sessionId, cdpUrl: target.webSocketDebuggerUrl, cdpToken };
}

export async function captureCookies(sessionId: string): Promise<CookieData> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  // Storage.getCookies on the browser endpoint returns every cookie chromium
  // is aware of (no per-page filtering), which is exactly what we want for a
  // login flow that may pivot across subdomains.
  const result = (await cdpCall(session.cdpBrowserWsUrl, "Storage.getCookies", {})) as {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
    }>;
  };
  const allowedDomains = new Set(session.cookieDomains.map((d) => d.replace(/^\./, "").toLowerCase()));

  const filtered = result.cookies.filter((c) => {
    const bare = c.domain.replace(/^\./, "").toLowerCase();
    return [...allowedDomains].some((d) => bare === d || bare.endsWith("." + d));
  });

  return {
    domain: session.targetDomain,
    cookies: filtered.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires && c.expires > 0 ? Math.floor(c.expires) : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    })),
    capturedAt: Math.floor(Date.now() / 1000),
  };
}

export function getSessionOwner(
  sessionId: string
): { userId: string; integration: string } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { userId: session.userId, integration: session.integration };
}

export function getSessionCdpEndpoint(
  sessionId: string,
  userId: string,
  cdpToken: string
): string | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (session.cdpToken !== cdpToken) return null;
  return session.cdpPageWsUrl;
}

export async function closeCookieSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  try { session.proc.kill("SIGKILL"); } catch { /* noop */ }
  sessions.delete(sessionId);
  await rm(session.userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

export function storeCookies(userId: string, integration: string, data: CookieData): void {
  const stmt = db.prepare(`
    INSERT INTO connections (user_id, integration, access_token, cookies, created_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(user_id, integration) DO UPDATE SET
      access_token = excluded.access_token,
      cookies = excluded.cookies,
      updated_at = unixepoch()
  `);
  stmt.run(userId, integration, encrypt("cookie-auth"), encrypt(JSON.stringify(data)));
}

export function getCookies(userId: string, integration: string): CookieData | null {
  const row = db.prepare("SELECT cookies FROM connections WHERE user_id = ? AND integration = ?").get(
    userId,
    integration
  ) as { cookies: Buffer } | undefined;

  if (!row?.cookies) return null;

  const decrypted = decrypt(row.cookies);
  return JSON.parse(decrypted) as CookieData;
}

export function deleteCookies(userId: string, integration: string): void {
  db.prepare("DELETE FROM connections WHERE user_id = ? AND integration = ?").run(userId, integration);
}

export function isCookieExpired(data: CookieData): boolean {
  const now = Math.floor(Date.now() / 1000);
  return data.cookies.some((c) => c.expires && c.expires < now);
}

export function hasValidCookies(userId: string, integration: string): boolean {
  const data = getCookies(userId, integration);
  if (!data) return false;
  return !isCookieExpired(data);
}
