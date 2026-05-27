import { getToken, TokenData } from "../auth/tokens";

export interface ToolContext {
  userId: string;
  getToken(): Promise<string>;
  http(url: string, init?: RequestInit): Promise<Response>;
}

export function createContext(userId: string, integration: string): ToolContext {
  let tokenData: TokenData | null = null;

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
      const token = await this.getToken();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);

      return fetch(url, {
        ...init,
        headers,
      });
    },
  };
}
