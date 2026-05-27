import { getToken, TokenData } from "../auth/tokens";
import { getCookies, CookieData, isCookieExpired } from "../auth/cookie";
import { registry } from "./registry";

export interface ToolContext {
  userId: string;
  getToken(): Promise<string>;
  http(url: string, init?: RequestInit): Promise<Response>;
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

      return fetch(url, {
        ...init,
        headers,
      });
    },
  };
}
