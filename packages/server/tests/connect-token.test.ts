import { describe, it, expect } from "vitest";
import { signConnectToken, verifyConnectToken } from "../src/auth/connect-token";

const payload = {
  connectionId: "conn-1",
  userId: "user-1",
  integration: "jira",
  sessionId: "sess-1",
};

describe("connect-token", () => {
  it("round-trips a valid token", async () => {
    const token = await signConnectToken(payload, 600);
    const decoded = await verifyConnectToken(token);
    expect(decoded.connectionId).toBe("conn-1");
    expect(decoded.userId).toBe("user-1");
    expect(decoded.integration).toBe("jira");
    expect(decoded.sessionId).toBe("sess-1");
  });

  it("does not carry a cdpToken", async () => {
    const token = await signConnectToken(payload, 600);
    const decoded = await verifyConnectToken(token);
    expect("cdpToken" in decoded).toBe(false);
  });

  it("rejects a tampered/garbage token", async () => {
    await expect(verifyConnectToken("not-a-jwt")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signConnectToken(payload, -1); // already expired
    await expect(verifyConnectToken(token)).rejects.toThrow();
  });

  it("rejects a session token (wrong audience)", async () => {
    const { signSession } = await import("../src/auth/session");
    const sessionToken = await signSession({ userId: "user-1", email: "a@b.c" });
    await expect(verifyConnectToken(sessionToken)).rejects.toThrow();
  });
});
