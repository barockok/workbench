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

  it("makes and verifies a per-jot token", () => {
    const t = makeToken("secret", "report");
    expect(verifyToken("secret", "report", t)).toBe(true);
    expect(verifyToken("secret", "other", t)).toBe(false);
    expect(verifyToken("other", "report", t)).toBe(false);
    expect(verifyToken("secret", "report", "tampered")).toBe(false);
  });

  it("namespaces the cookie name", () => {
    expect(cookieName("report")).toBe("jot_report");
  });
});
