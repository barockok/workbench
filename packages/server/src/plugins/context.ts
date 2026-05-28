import { getToken, TokenData } from "../auth/tokens";
import { getCookies, CookieData, isCookieExpired } from "../auth/cookie";
import { registry } from "./registry";

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

        const cookieHeader = cookieData.cookies
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
