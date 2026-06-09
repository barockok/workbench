import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, makeToken, verifyToken, cookieName } from "../../src/jots/auth";

describe("jots/auth", () => {
  it("hashes and verifies a password", () => {
    const stored = hashPassword("hunter2");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("hunter2", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("makes and verifies a per-jot, per-password token", () => {
    const h = "scrypt$aa$bb";
    const t = makeToken("secret", "report", h);
    expect(verifyToken("secret", "report", h, t)).toBe(true);
    expect(verifyToken("secret", "other", h, t)).toBe(false);
    expect(verifyToken("other", "report", h, t)).toBe(false);
    expect(verifyToken("secret", "report", h, "tampered")).toBe(false);
    // Rotating the password (new hash) invalidates a token minted for the old one.
    expect(verifyToken("secret", "report", "scrypt$cc$dd", t)).toBe(false);
  });

  it("namespaces the cookie name", () => {
    expect(cookieName("report")).toBe("jot_report");
  });
});
