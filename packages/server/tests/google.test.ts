import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildAuthUrl, handleCallback, exchangeCodeForTokens, verifyGoogleIdToken } from "../src/auth/google";
import { db } from "../src/db";
import * as oauth from "../src/auth/oauth";
import { jwtVerify, createRemoteJWKSet } from "jose";

vi.mock("../src/config", () => ({
  config: {
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    PORTAL_URL: "http://localhost:5173",
    SESSION_SECRET: "test-session-secret-32-chars-long!!",
    ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "./data/tokens.db",
    PLUGINS_DIR: "./plugins",
    AUDIT_LOG_DEST: "sqlite",
    AUDIT_LOG_KAFKA_TOPIC: "audit-log",
  },
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
}));

beforeEach(() => {
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM pending_auth");
  vi.restoreAllMocks();
  global.fetch = vi.fn(() => Promise.resolve(new Response('{"jwks_uri":"https://accounts.google.com/jwks"}'))) as any;
});

describe("google auth", () => {
  it("builds auth URL with correct params", () => {
    const url = buildAuthUrl();
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(parsed.searchParams.get("nonce")).toBeTruthy();
    expect(parsed.searchParams.get("scope")).toContain("openid");
    expect(parsed.searchParams.get("redirect_uri")).toContain("/auth/google/callback");
  });

  it("rejects invalid state in callback", async () => {
    await expect(handleCallback("code", "invalid-state")).rejects.toThrow("Invalid state");
  });

  it("rejects missing nonce in callback", async () => {
    // Create a valid state but skip nonce storage
    const state = oauth.createAuthState("user-1", "google-sso");
    await expect(handleCallback("code", state)).rejects.toThrow("Invalid or expired nonce");
  });

  it("stores state in pending_auth and nonce in map", () => {
    const url = buildAuthUrl();
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const nonce = parsed.searchParams.get("nonce")!;

    // State should be verifiable
    const authState = oauth.verifyAuthState(state);
    expect(authState).not.toBeNull();
    expect(authState?.integration).toBe("google-sso");

    // After verification, state is consumed
    expect(oauth.verifyAuthState(state)).toBeNull();
  });
});

describe("exchangeCodeForTokens", () => {
  it("exchanges code for tokens", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id_token: "id-123", access_token: "acc-456", expires_in: 3600 }))
    );
    const tokens = await exchangeCodeForTokens("auth-code");
    expect(tokens.id_token).toBe("id-123");
    expect(tokens.access_token).toBe("acc-456");
  });

  it("throws on failed exchange", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("error", { status: 400 }));
    await expect(exchangeCodeForTokens("bad-code")).rejects.toThrow("Token exchange failed");
  });
});

describe("verifyGoogleIdToken", () => {
  it("verifies valid token", async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-123", email: "test@example.com", email_verified: true, name: "Test User", nonce: "nonce-123" },
    } as any);

    const user = await verifyGoogleIdToken("valid-token", "nonce-123");
    expect(user.sub).toBe("google-123");
    expect(user.email).toBe("test@example.com");
    expect(user.email_verified).toBe(true);
    expect(user.name).toBe("Test User");
  });

  it("throws on invalid payload", async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-123" }, // missing email
    } as any);
    await expect(verifyGoogleIdToken("bad-token")).rejects.toThrow("Invalid ID token payload");
  });

  it("throws on nonce mismatch", async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-123", email: "test@example.com", nonce: "wrong-nonce" },
    } as any);
    await expect(verifyGoogleIdToken("token", "expected-nonce")).rejects.toThrow("Invalid nonce");
  });
});

describe("handleCallback", () => {
  function getStateAndNonce() {
    const url = buildAuthUrl();
    const parsed = new URL(url);
    return {
      state: parsed.searchParams.get("state")!,
      nonce: parsed.searchParams.get("nonce")!,
    };
  }

  it("creates new user on first login", async () => {
    const { state, nonce } = getStateAndNonce();

    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-123", email: "new@example.com", email_verified: true, nonce },
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "id-123", access_token: "acc-456", expires_in: 3600 }))
    );

    const result = await handleCallback("code", state);
    expect(result.email).toBe("new@example.com");
    expect(result.userId).toBeTruthy();
  });

  it("links existing user by email", async () => {
    db.prepare("INSERT INTO users (id, email, google_sub) VALUES (?, ?, ?)").run("user-1", "existing@example.com", null);

    const { state, nonce } = getStateAndNonce();

    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-456", email: "existing@example.com", email_verified: true, nonce },
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "id-123", access_token: "acc-456", expires_in: 3600 }))
    );

    const result = await handleCallback("code", state);
    expect(result.userId).toBe("user-1");
    expect(result.email).toBe("existing@example.com");

    const row = db.prepare("SELECT google_sub FROM users WHERE id = ?").get("user-1") as { google_sub: string };
    expect(row.google_sub).toBe("google-456");
  });

  it("throws when email not verified", async () => {
    const { state, nonce } = getStateAndNonce();

    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: "google-123", email: "unverified@example.com", email_verified: false, nonce },
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "id-123", access_token: "acc-456", expires_in: 3600 }))
    );

    await expect(handleCallback("code", state)).rejects.toThrow("Email not verified");
  });
});
