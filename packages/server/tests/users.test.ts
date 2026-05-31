import { describe, it, expect, beforeEach } from "vitest";
import { createUser, verifyApiKey, setApiKey, clearApiKey, hasApiKey } from "../src/auth/users";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM users");
});

// An existing user (e.g. created via Google SSO) with no api key yet.
function seedUser(id: string) {
  db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(id, `${id}@x.test`);
}

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

describe("api key management for existing users", () => {
  it("mints a key for an existing user and verifies it", () => {
    seedUser("bob");
    const { apiKey } = setApiKey("bob");
    expect(apiKey).toHaveLength(64);
    expect(verifyApiKey(apiKey)).toBe("bob");
    expect(hasApiKey("bob")).toBe(true);
  });

  it("rotates the key: old key stops working, new key works", () => {
    seedUser("bob");
    const { apiKey: first } = setApiKey("bob");
    const { apiKey: second } = setApiKey("bob");
    expect(second).not.toBe(first);
    expect(verifyApiKey(first)).toBeNull();
    expect(verifyApiKey(second)).toBe("bob");
  });

  it("reports hasApiKey false before minting", () => {
    seedUser("bob");
    expect(hasApiKey("bob")).toBe(false);
  });

  it("revokes the key", () => {
    seedUser("bob");
    const { apiKey } = setApiKey("bob");
    clearApiKey("bob");
    expect(hasApiKey("bob")).toBe(false);
    expect(verifyApiKey(apiKey)).toBeNull();
  });
});
