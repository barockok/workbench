import { describe, it, expect, beforeEach } from "vitest";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_refresh_tokens"));

describe("oauth refresh tokens", () => {
  it("issues then rotates: old token invalid, new token valid", async () => {
    const t1 = await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    const r = await rotateRefreshToken(t1, "c1");
    expect(r?.userId).toBe("u1");
    expect(r?.newToken).toBeTruthy();
    expect(await rotateRefreshToken(t1, "c1")).toBeNull();
    expect((await rotateRefreshToken(r!.newToken, "c1"))?.userId).toBe("u1");
  });

  it("rejects rotation with a mismatched client", async () => {
    const t1 = await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    expect(await rotateRefreshToken(t1, "other")).toBeNull();
  });

  // Single-use is enforced by the DELETE's row count inside the rotation
  // transaction, not by the SELECT that precedes it. Both callers see the row;
  // only one can consume it.
  it("lets exactly one of two concurrent rotations win", async () => {
    const t1 = await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    const results = await Promise.all([rotateRefreshToken(t1, "c1"), rotateRefreshToken(t1, "c1")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
