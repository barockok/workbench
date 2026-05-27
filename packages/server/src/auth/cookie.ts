import { chromium, BrowserServer, BrowserContext } from "playwright";
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
  browserServer: BrowserServer;
  context: BrowserContext;
  cdpWsUrl: string;
  loginUrl: string;
  targetDomain: string;
  cookieDomains: string[];
  userId: string;
  integration: string;
}

const sessions = new Map<string, Session>();

export async function startCookieSession(
  userId: string,
  integration: string,
  loginUrl: string,
  targetDomain: string,
  cookieDomains: string[] = []
): Promise<{ sessionId: string; cdpUrl: string }> {
  const browserServer = await chromium.launchServer({ headless: false });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(loginUrl);

  const cdpWsUrl = browserServer.wsEndpoint();
  const sessionId = crypto.randomUUID();

  sessions.set(sessionId, {
    browserServer,
    context,
    cdpWsUrl,
    loginUrl,
    targetDomain,
    cookieDomains: [targetDomain, ...cookieDomains],
    userId,
    integration,
  });

  return { sessionId, cdpUrl: cdpWsUrl };
}

export async function captureCookies(sessionId: string): Promise<CookieData> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const allCookies = await session.context.cookies();
  const allowedDomains = new Set(session.cookieDomains);

  const filtered = allCookies.filter((c) => {
    return allowedDomains.has(c.domain) || allowedDomains.has(c.domain.replace(/^\./, ""));
  });

  return {
    domain: session.targetDomain,
    cookies: filtered.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires > 0 ? Math.floor(c.expires) : undefined,
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

export async function closeCookieSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  await session.browserServer.close();
  sessions.delete(sessionId);
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
