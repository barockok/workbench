import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken } from "../src/auth/oauth-server/tokens";

describe("oauth access tokens", () => {
  it("signs and verifies, returning the subject + scope", async () => {
    const tok = await signAccessToken({ userId: "u1", scope: "mcp", clientId: "c1" });
    const claims = await verifyAccessToken(tok);
    expect(claims.userId).toBe("u1");
    expect(claims.scope).toBe("mcp");
    expect(claims.clientId).toBe("c1");
  });

  it("rejects a garbage token", async () => {
    await expect(verifyAccessToken("not-a-jwt")).rejects.toThrow();
  });
});
