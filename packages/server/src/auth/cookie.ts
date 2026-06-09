import { rm } from "node:fs/promises";
import WebSocket from "ws";
import { db } from "../db";
import { encrypt, decrypt } from "./encryption";
import { activeProfiles, userProfileDir } from "./profile-chromium";

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
export function startProxyAuth(browserWsUrl: string, username: string, password: string): WebSocket {
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
