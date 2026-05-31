import { describe, it, expect, beforeEach } from "vitest";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_refresh_tokens"));

describe("oauth refresh tokens", () => {
  it("issues then rotates: old token invalid, new token valid", () => {
    const t1 = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    const r = rotateRefreshToken(t1, "c1");
    expect(r?.userId).toBe("u1");
    expect(r?.newToken).toBeTruthy();
    expect(rotateRefreshToken(t1, "c1")).toBeNull();
    expect(rotateRefreshToken(r!.newToken, "c1")?.userId).toBe("u1");
  });

  it("rejects rotation with a mismatched client", () => {
    const t1 = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    expect(rotateRefreshToken(t1, "other")).toBeNull();
  });
});
