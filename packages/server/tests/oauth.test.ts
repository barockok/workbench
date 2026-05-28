import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAuthState, verifyAuthState, exchangeCode } from "../src/auth/oauth";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM pending_auth");
  vi.restoreAllMocks();
  global.fetch = vi.fn();
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

  it("prunes expired states on create", () => {
    const oldState = createAuthState("alice", "jira");
    verifyAuthState(oldState);
    const newState = createAuthState("bob", "confluence");
    expect(verifyAuthState(oldState)).toBeNull();
    expect(verifyAuthState(newState)).not.toBeNull();
  });

  describe("exchangeCode", () => {
    it("exchanges code for tokens", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }))
      );
      const result = await exchangeCode("https://example.com/token", "id", "secret", "code", "https://localhost/callback");
      expect(result.access_token).toBe("tok");
      expect(result.refresh_token).toBe("ref");
      expect(result.expires_in).toBe(3600);
    });

    it("exchanges code without refresh token", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ access_token: "tok" }))
      );
      const result = await exchangeCode("https://example.com/token", "id", "secret", "code", "https://localhost/callback");
      expect(result.access_token).toBe("tok");
      expect(result.refresh_token).toBeUndefined();
      expect(result.expires_in).toBeUndefined();
    });

    it("throws on failed exchange", async () => {
      vi.mocked(global.fetch).mockResolvedValue(new Response("error", { status: 400 }));
      await expect(exchangeCode("https://example.com/token", "id", "secret", "bad", "https://localhost/callback")).rejects.toThrow("Token exchange failed: 400");
    });
  });
});
