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
        const cookieHeader = cookieData.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        headers.set("Cookie", cookieHeader);
      } else {
        const token = await this.getToken();
        headers.set("Authorization", `Bearer ${token}`);
      }

      return fetch(url, {
        ...init,
        headers,
      });
    },
  };
}
