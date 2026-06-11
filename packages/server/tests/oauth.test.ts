import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createAuthState,
  verifyAuthState,
  exchangeCode,
  generateCodeVerifier,
  codeChallengeS256,
} from "../src/auth/oauth";
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

  it("round-trips the PKCE verifier through state", () => {
    const state = createAuthState("alice", "jira", "my-verifier");
    expect(verifyAuthState(state)?.codeVerifier).toBe("my-verifier");
  });

  it("returns undefined verifier when none was stored", () => {
    const state = createAuthState("alice", "jira");
    expect(verifyAuthState(state)?.codeVerifier).toBeUndefined();
  });

  describe("PKCE helpers", () => {
    it("generates unique base64url verifiers", () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("computes the RFC 7636 appendix-B challenge", () => {
      // Verifier/challenge pair straight from the RFC's worked example.
      expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });
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

    it("omits client_secret and sends code_verifier for public clients", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ access_token: "tok" }))
      );
      await exchangeCode("https://example.com/token", "id", undefined, "code", "https://localhost/callback", "verifier-1");
      const body = vi.mocked(global.fetch).mock.calls[0][1]?.body as URLSearchParams;
      expect(body.has("client_secret")).toBe(false);
      expect(body.get("code_verifier")).toBe("verifier-1");
    });

    it("sends both client_secret and code_verifier for confidential clients with PKCE", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ access_token: "tok" }))
      );
      await exchangeCode("https://example.com/token", "id", "secret", "code", "https://localhost/callback", "verifier-1");
      const body = vi.mocked(global.fetch).mock.calls[0][1]?.body as URLSearchParams;
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("code_verifier")).toBe("verifier-1");
    });
  });
});
