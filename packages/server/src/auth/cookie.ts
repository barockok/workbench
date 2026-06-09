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
  // Persistent CDP socket answering authenticated-proxy challenges, if any.
  authWs?: WebSocket;
}

const sessions = new Map<string, Session>();

// Chromium can't take proxy credentials on the command line (and can't do
// SOCKS5 user/pass auth at all). For an authenticated HTTP proxy we answer the
// CDP `Fetch.authRequired` challenge with the configured creds. This factory
// returns a per-connection message handler: it auto-enables Fetch on every
// attached target, hands the credentials to PROXY challenges only (never the
// site's own auth), and lets every other paused request through.
type CdpSend = (payload: Record<string, unknown>) => void;
export function createProxyAuthHandler(creds: { username: string; password: string }) {
  let id = 1000;
  return function handle(msg: Record<string, any>, send: CdpSend): void {
    if (msg.method === "Target.attachedToTarget") {
      send({ sessionId: msg.params.sessionId, id: id++, method: "Fetch.enable", params: { handleAuthRequests: true } });
    } else if (msg.method === "Fetch.authRequired") {
      const isProxy = msg.params?.authChallenge?.source === "Proxy";
      send({
        sessionId: msg.sessionId,
        id: id++,
        method: "Fetch.continueWithAuth",
        params: {
          requestId: msg.params.requestId,
          authChallengeResponse: isProxy
            ? { response: "ProvideCredentials", username: creds.username, password: creds.password }
            : { response: "Default" },
        },
      });
    } else if (msg.method === "Fetch.requestPaused") {
      send({ sessionId: msg.sessionId, id: id++, method: "Fetch.continueRequest", params: { requestId: msg.params.requestId } });
    }
  };
}

// Open a persistent browser-level CDP connection that auto-attaches to every
// target and feeds proxy-auth challenges through createProxyAuthHandler.
// Returns the socket so the session can close it on teardown.
function startProxyAuth(browserWsUrl: string, username: string, password: string): WebSocket {
  const handler = createProxyAuthHandler({ username, password });
  const ws = new WebSocket(browserWsUrl, { perMessageDeflate: false, origin: "http://127.0.0.1" });
  ws.on("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true, waitForDebuggerOnStart: false } }));
  });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handler(msg, (payload) => ws.send(JSON.stringify(payload)));
    } catch { /* ignore malformed frames */ }
  });
  ws.on("error", () => { /* best-effort; capture still works without proxy auth */ });
  return ws;
}

export async function startCookieSession(
  userId: string,
  integration: string,
  loginUrl: string,
  targetDomain: string,
  cookieDomains: string[] = []
): Promise<{ sessionId: string; cdpUrl: string; cdpToken: string }> {
  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: a browser session is already active for this user");
  }
  activeProfiles.add(userId);

  try {
    const { proc, remotePort, cdpBrowserWsUrl, cdpPageWsUrl } =
      await spawnProfileChromium(userId, { startUrl: loginUrl });

    const sessionId = crypto.randomUUID();
    const cdpToken = crypto.randomUUID();

    // If the capture proxy needs auth, open the persistent CDP socket that
    // answers proxy-auth challenges (chromium can't take proxy creds otherwise).
    const proxyUser = process.env.CAPTURE_PROXY_USERNAME;
    const proxyPass = process.env.CAPTURE_PROXY_PASSWORD;
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

    // Release the per-user lock if the browser crashes or is killed externally.
    // Set.delete and Map.delete are idempotent so this is safe even if
    // closeCookieSession already ran.
    proc.on("exit", () => {
      activeProfiles.delete(userId);
      sessions.delete(sessionId);
      try { session.authWs?.close(); } catch { /* noop */ }
    });

    return { sessionId, cdpUrl: cdpPageWsUrl, cdpToken };
  } catch (e) {
    activeProfiles.delete(userId);
    throw e;
  }
}

export type RawCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

// Pure: scope raw CDP cookies to the allowed domains (host-or-subdomain match,
// browser-like), drop cookies already expired at `now`, and normalize into the
// stored CookieData cookie shape. No I/O, no session — unit-testable.
export function filterCookies(
  raw: RawCookie[],
  domains: string[],
  now: number = Math.floor(Date.now() / 1000)
): CookieData["cookies"] {
  const allowed = new Set(domains.map((d) => d.replace(/^\./, "").toLowerCase()));
  const allowedArr = Array.from(allowed);
  return raw
    .filter((c) => {
      if (c.expires && c.expires > 0 && c.expires < now) return false;
      const bare = c.domain.replace(/^\./, "").toLowerCase();
      return allowedArr.some((d) => bare === d || bare.endsWith("." + d));
    })
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires && c.expires > 0 ? Math.floor(c.expires) : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
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
  const cookies = filterCookies(result.cookies, session.cookieDomains);
  return {
    domain: session.targetDomain,
    cookies,
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
  activeProfiles.delete(session.userId);
  try { session.authWs?.close(); } catch { /* noop */ }
  try { session.proc.kill("SIGKILL"); } catch { /* noop */ }
  sessions.delete(sessionId);
}

// Wipe a user's persistent browser profile (logout-everywhere / repair).
// Refuses while a capture session is active — would delete an in-use dir.
export async function resetBrowserProfile(userId: string): Promise<void> {
  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: finish or cancel the active browser session first");
  }
  await rm(userProfileDir(userId), { recursive: true, force: true }).catch(() => undefined);
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
  // A connection is dead only when NO usable cookie remains — not when *any*
  // single cookie has lapsed. Capture sweeps in unrelated short-lived cookies
  // (SSO session-hash, third-party analytics) that expire seconds after
  // capture; the old "some expired → dead" logic let that junk poison an
  // otherwise-valid session. A cookie with no `expires` is a session cookie
  // and always counts as live.
  const now = Math.floor(Date.now() / 1000);
  if (data.cookies.length === 0) return true;
  const liveCount = data.cookies.filter((c) => !c.expires || c.expires >= now).length;
  return liveCount === 0;
}

export function hasValidCookies(userId: string, integration: string): boolean {
  const data = getCookies(userId, integration);
  if (!data) return false;
  return !isCookieExpired(data);
}
