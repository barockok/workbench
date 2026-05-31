import { getToken, storeToken, TokenData } from "../auth/tokens";
import { getCookies, CookieData, isCookieExpired } from "../auth/cookie";
import { getPluginOAuthCreds } from "../auth/plugin-oauth";
import { registry } from "./registry";

// Refresh a few seconds before the actual expiry to absorb clock skew.
const TOKEN_EXPIRY_SKEW_SECONDS = 30;

async function refreshAccessToken(
  userId: string,
  integration: string,
  data: TokenData
): Promise<TokenData> {
  if (!data.refreshToken) throw new Error("Token expired and no refresh_token stored");
  const integ = registry.getIntegration(integration);
  if (!integ || integ.auth.type !== "oauth2") {
    throw new Error("Cannot refresh non-oauth2 integration");
  }
  const creds = getPluginOAuthCreds(integration);
  if (!creds) throw new Error(`OAuth client not configured for ${integration}`);

  const res = await fetch(integ.auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: data.refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Refresh failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const refreshed: TokenData = {
    accessToken: tokens.access_token,
    // Some providers (Google) re-issue the same refresh token implicitly;
    // others (Atlassian) rotate it. Keep whichever we last saw.
    refreshToken: tokens.refresh_token ?? data.refreshToken,
    expiresAt: tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : undefined,
    scopes: data.scopes,
  };
  storeToken(userId, integration, refreshed);
  return refreshed;
}

export interface ToolContext {
  userId: string;
  getToken(): Promise<string>;
  http(url: string, init?: RequestInit): Promise<Response>;
}

// Cache resolved Atlassian cloud IDs per (user, product) so we don't hit
// the /accessible-resources endpoint on every tool call.
const atlassianCloudIdCache = new Map<string, string>();

async function resolveAtlassianCloudId(
  accessToken: string,
  product: "jira" | "confluence"
): Promise<string> {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`accessible-resources ${res.status}`);
  const sites = (await res.json()) as Array<{ id: string; scopes?: string[]; url?: string }>;
  const needle = product === "jira" ? "jira" : "confluence";
  const match = sites.find((s) => (s.scopes ?? []).some((sc) => sc.includes(needle))) ?? sites[0];
  if (!match) throw new Error(`No accessible Atlassian site for ${product}`);
  return match.id;
}

export function createContext(userId: string, integration: string): ToolContext {
  let tokenData: TokenData | null = null;
  let cookieData: CookieData | null = null;

  return {
    userId,

    async getToken(): Promise<string> {
      if (!tokenData) {
        tokenData = getToken(userId, integration);
        if (!tokenData) throw new Error("Not connected");
      }
      const now = Math.floor(Date.now() / 1000);
      if (tokenData.expiresAt && tokenData.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS <= now) {
        tokenData = await refreshAccessToken(userId, integration, tokenData);
      }
      return tokenData.accessToken;
    },

    async http(url: string, init?: RequestInit): Promise<Response> {
      const integrationConfig = registry.getIntegration(integration);
      const headers = new Headers(init?.headers);

      if (integrationConfig?.auth.type === "cookie") {
        if (!cookieData) {
          cookieData = getCookies(userId, integration);
          if (!cookieData || isCookieExpired(cookieData)) {
            throw new Error("NOT_CONNECTED");
          }
        }

        // Restrict cookie attachment to declared domains.
        // Prevents credential exfiltration if a plugin (or open-redirect)
        // points ctx.http() at an attacker-controlled URL.
        const targetHost = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
        const allowed = [
          integrationConfig.auth.targetDomain,
          ...(integrationConfig.auth.cookieDomains ?? []),
        ].map((d) => d.replace(/^\./, "").toLowerCase());

        if (!allowed.some((d) => targetHost === d || targetHost.endsWith("." + d))) {
          throw new Error(
            `Cookie auth: URL host ${targetHost} not in declared cookieDomains`
          );
        }

        // Send only the cookies a browser would send to this host:
        //  - drop cookies that have since expired (a cookie can lapse between
        //    capture and use);
        //  - scope by domain — a host-only cookie (domain === host) goes only
        //    to that host; a domain cookie (.example.com) goes to the domain
        //    and its subdomains. Capture sweeps in sibling-host cookies (e.g.
        //    sso.* Keycloak cookies); replaying ALL of them to one host both
        //    bloats the header past the upstream's limit (nginx "400 Request
        //    Header Or Cookie Too Large") and breaks auth that expects exactly
        //    the browser's cookie set.
        const nowSec = Math.floor(Date.now() / 1000);
        const cookieHeader = cookieData.cookies
          .filter((c) => !c.expires || c.expires >= nowSec)
          .filter((c) => {
            const cd = c.domain.replace(/^\./, "").toLowerCase();
            return targetHost === cd || targetHost.endsWith("." + cd);
          })
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        headers.set("Cookie", cookieHeader);

        // redirect:'manual' so a 3xx to a foreign host cannot launder cookies.
        // Caller must explicitly re-issue ctx.http() to follow a same-host redirect.
        return fetch(url, { ...init, headers, redirect: "manual" });
      }

      const token = await this.getToken();
      headers.set("Authorization", `Bearer ${token}`);

      // Atlassian plugins ship URLs with a literal `cloud-id` placeholder
      // (because the OAuth flow doesn't know which Atlassian site the user
      // will pick until consent). Resolve and substitute it on the fly.
      let resolvedUrl = url;
      const atlassianMatch = url.match(/^https:\/\/api\.atlassian\.com\/ex\/(jira|confluence)\/cloud-id\//);
      if (atlassianMatch) {
        const product = atlassianMatch[1] as "jira" | "confluence";
        const cacheKey = `${userId}:${product}`;
        let cloudId = atlassianCloudIdCache.get(cacheKey);
        if (!cloudId) {
          cloudId = await resolveAtlassianCloudId(token, product);
          atlassianCloudIdCache.set(cacheKey, cloudId);
        }
        resolvedUrl = url.replace(
          `/ex/${product}/cloud-id/`,
          `/ex/${product}/${cloudId}/`
        );
      }

      return fetch(resolvedUrl, {
        ...init,
        headers,
      });
    },
  };
}
