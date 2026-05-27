import { describe, it, expect, beforeEach } from "vitest";
import { storeToken, getToken, deleteToken } from "../src/auth/tokens";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM connections");
});

describe("tokens", () => {
  it("stores and retrieves token", () => {
    storeToken("alice", "jira", {
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: 1700000000,
      scopes: "read:jira write:jira",
    });

    const result = getToken("alice", "jira");
    expect(result?.accessToken).toBe("at-123");
    expect(result?.refreshToken).toBe("rt-456");
  });

  it("returns null for missing token", () => {
    const result = getToken("alice", "missing");
    expect(result).toBeNull();
  });

  it("deletes token", () => {
    storeToken("alice", "jira", { accessToken: "at", scopes: "" });
    deleteToken("alice", "jira");
    expect(getToken("alice", "jira")).toBeNull();
  });
});
