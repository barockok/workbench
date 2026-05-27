import { describe, it, expect, beforeEach } from "vitest";
import { createUser, verifyApiKey } from "../src/auth/users";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM users");
});

describe("users", () => {
  it("creates user with api key", () => {
    const { apiKey } = createUser("alice");
    expect(apiKey).toHaveLength(64);
  });

  it("verifies valid api key", () => {
    const { apiKey } = createUser("alice");
    const userId = verifyApiKey(apiKey);
    expect(userId).toBe("alice");
  });

  it("rejects invalid api key", () => {
    const userId = verifyApiKey("invalid");
    expect(userId).toBeNull();
  });
});
