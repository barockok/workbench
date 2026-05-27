import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildAuthUrl, handleCallback } from "../src/auth/google";
import { db } from "../src/db";
import * as oauth from "../src/auth/oauth";

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

beforeEach(() => {
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM pending_auth");
  vi.restoreAllMocks();
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
