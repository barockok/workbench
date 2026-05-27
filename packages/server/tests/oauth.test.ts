import { describe, it, expect, beforeEach } from "vitest";
import { createAuthState, verifyAuthState } from "../src/auth/oauth";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM pending_auth");
});

describe("oauth", () => {
  it("creates and verifies state", () => {
    const state = createAuthState("alice", "jira");
    const result = verifyAuthState(state);
    expect(result?.userId).toBe("alice");
    expect(result?.integration).toBe("jira");
  });

  it("rejects invalid state", () => {
    const result = verifyAuthState("invalid");
    expect(result).toBeNull();
  });

  it("deletes state after verification", () => {
    const state = createAuthState("alice", "jira");
    verifyAuthState(state);
    const result = verifyAuthState(state);
    expect(result).toBeNull();
  });
});
