import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/auth/session";

describe("session", () => {
  it("signs and verifies a session token", async () => {
    const token = await signSession({ userId: "user-123", email: "alice@example.com" });
    const payload = await verifySession(token);
    expect(payload.userId).toBe("user-123");
    expect(payload.email).toBe("alice@example.com");
  });

  it("rejects invalid token", async () => {
    await expect(verifySession("bad.token.here")).rejects.toThrow();
  });

  it("rejects expired token", async () => {
    const token = await signSession({ userId: "user-123", email: "alice@example.com" }, -1);
    await expect(verifySession(token)).rejects.toThrow();
  });
});
