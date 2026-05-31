import { verifyApiKey } from "../users";
import { verifySession } from "../session";
import { verifyAccessToken } from "./tokens";

// Resolve the /mcp caller: API key header, then OAuth Bearer, then session JWT.
export async function resolveMcpUser(headers: {
  authorization?: string;
  "x-workbench-api-key"?: string;
}): Promise<string | null> {
  const apiKey = headers["x-workbench-api-key"];
  if (apiKey) {
    const u = verifyApiKey(apiKey);
    if (u) return u;
  }
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      return (await verifyAccessToken(token)).userId; // OAuth access token
    } catch {
      try {
        return (await verifySession(token)).userId;   // portal session JWT
      } catch {
        return null;
      }
    }
  }
  return null;
}
