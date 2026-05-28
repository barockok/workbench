import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  envVarPrefix,
  getPluginOAuthCreds,
  getPluginCallbackUrl,
  buildPluginAuthUrl,
  handlePluginCallback,
} from "../src/auth/plugin-oauth";
import { registry } from "../src/plugins/registry";
import * as oauth from "../src/auth/oauth";
import * as tokens from "../src/auth/tokens";

vi.mock("../src/config", () => ({
  config: {
    SERVER_PUBLIC_URL: "http://localhost:3000",
    PORTAL_URL: "http://localhost:5173",
    ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "./data/tokens.db",
    PLUGINS_DIR: "./plugins",
    AUDIT_LOG_DEST: "sqlite",
    AUDIT_LOG_KAFKA_TOPIC: "audit-log",
  },
}));

vi.mock("../src/auth/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/tokens")>();
  return {
    ...actual,
    storeToken: vi.fn(),
  };
});

const mockIntegration = {
  name: "google-gmail",
  version: "1.0.0",
  auth: {
    type: "oauth2" as const,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  },
};

const mockCookieIntegration = {
  name: "legacy-app",
  version: "1.0.0",
  auth: {
    type: "cookie" as const,
    loginUrl: "https://example.com/login",
    targetDomain: "example.com",
  },
};

describe("envVarPrefix", () => {
  it("converts kebab to upper snake", () => {
    expect(envVarPrefix("google-gmail")).toBe("GOOGLE_GMAIL");
    expect(envVarPrefix("atlassian-jira")).toBe("ATLASSIAN_JIRA");
    expect(envVarPrefix("github")).toBe("GITHUB");
  });
});

describe("getPluginOAuthCreds", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  });

  it("returns creds when env vars are set", () => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    const creds = getPluginOAuthCreds("google-gmail");
    expect(creds).toEqual({ clientId: "gmail-id", clientSecret: "gmail-secret" });
  });

  it("returns null when client id is missing", () => {
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    expect(getPluginOAuthCreds("google-gmail")).toBeNull();
  });

  it("returns null when client secret is missing", () => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    expect(getPluginOAuthCreds("google-gmail")).toBeNull();
  });

  it("returns null when both are missing", () => {
    expect(getPluginOAuthCreds("google-gmail")).toBeNull();
  });
});

describe("getPluginCallbackUrl", () => {
  it("builds callback url with integration name", () => {
    expect(getPluginCallbackUrl("google-gmail")).toBe(
      "http://localhost:3000/api/auth/plugin/google-gmail/callback"
    );
  });
});

describe("buildPluginAuthUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockIntegration);
    vi.spyOn(oauth, "createAuthState").mockReturnValue("test-state");
  });

  it("builds auth url with all required params", () => {
    const url = buildPluginAuthUrl("user-1", "google-gmail");
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe("gmail-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/plugin/google-gmail/callback"
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
    expect(parsed.searchParams.get("state")).toBe("test-state");
  });

  it("adds google-specific extra params", () => {
    const url = buildPluginAuthUrl("user-1", "google-gmail");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("throws when integration not found", () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
    expect(() => buildPluginAuthUrl("user-1", "unknown")).toThrow("Integration not found: unknown");
  });

  it("throws when integration is not oauth2", () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration);
    expect(() => buildPluginAuthUrl("user-1", "legacy-app")).toThrow(
      "Integration legacy-app is not oauth2"
    );
  });

  it("throws when creds not configured", () => {
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    expect(() => buildPluginAuthUrl("user-1", "google-gmail")).toThrow(
      "OAuth client not configured for google-gmail"
    );
  });

  it("does not add extra params for non-google plugins", () => {
    const nonGoogleIntegration = {
      ...mockIntegration,
      name: "github",
      auth: {
        ...mockIntegration.auth,
        authorizationUrl: "https://github.com/login/oauth/authorize",
      },
    };
    process.env.GITHUB_CLIENT_ID = "github-id";
    process.env.GITHUB_CLIENT_SECRET = "github-secret";
    vi.spyOn(registry, "getIntegration").mockReturnValue(nonGoogleIntegration);
    const url = buildPluginAuthUrl("user-1", "github");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_type")).toBeNull();
    expect(parsed.searchParams.get("prompt")).toBeNull();
  });
});

describe("handlePluginCallback", () => {
  beforeEach(() => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockIntegration);
    vi.spyOn(oauth, "verifyAuthState").mockReturnValue({
      userId: "user-1",
      integration: "google-gmail",
    });
    vi.spyOn(oauth, "exchangeCode").mockResolvedValue({
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
    });
    vi.spyOn(tokens, "storeToken").mockImplementation(() => {});
  });

  it("exchanges code and stores token", async () => {
    const result = await handlePluginCallback("google-gmail", "auth-code", "valid-state");
    expect(result).toEqual({ userId: "user-1" });
    expect(oauth.exchangeCode).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      "gmail-id",
      "gmail-secret",
      "auth-code",
      "http://localhost:3000/api/auth/plugin/google-gmail/callback"
    );
    expect(tokens.storeToken).toHaveBeenCalledWith(
      "user-1",
      "google-gmail",
      expect.objectContaining({
        accessToken: "access-123",
        refreshToken: "refresh-456",
        scopes: "https://www.googleapis.com/auth/gmail.modify",
      })
    );
  });

  it("calculates expiresAt from expires_in", async () => {
    const before = Math.floor(Date.now() / 1000);
    await handlePluginCallback("google-gmail", "auth-code", "valid-state");
    const after = Math.floor(Date.now() / 1000);
    expect(tokens.storeToken).toHaveBeenCalledWith(
      "user-1",
      "google-gmail",
      expect.objectContaining({
        expiresAt: expect.any(Number),
      })
    );
    const callArgs = (tokens.storeToken as any).mock.calls[0][2];
    expect(callArgs.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(callArgs.expiresAt).toBeLessThanOrEqual(after + 3600);
  });

  it("rejects invalid state", async () => {
    vi.spyOn(oauth, "verifyAuthState").mockReturnValue(null);
    await expect(handlePluginCallback("google-gmail", "code", "bad-state")).rejects.toThrow(
      "Invalid state"
    );
  });

  it("rejects state for wrong integration", async () => {
    vi.spyOn(oauth, "verifyAuthState").mockReturnValue({
      userId: "user-1",
      integration: "google-drive",
    });
    await expect(handlePluginCallback("google-gmail", "code", "valid-state")).rejects.toThrow(
      "Invalid state"
    );
  });

  it("throws when integration not found", async () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
    await expect(handlePluginCallback("google-gmail", "code", "state")).rejects.toThrow(
      "Integration not configured for OAuth"
    );
  });

  it("throws when integration is not oauth2", async () => {
    vi.spyOn(oauth, "verifyAuthState").mockReturnValue({
      userId: "user-1",
      integration: "legacy-app",
    });
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration);
    await expect(handlePluginCallback("legacy-app", "code", "state")).rejects.toThrow(
      "Integration not configured for OAuth"
    );
  });

  it("throws when creds not configured", async () => {
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    await expect(handlePluginCallback("google-gmail", "code", "state")).rejects.toThrow(
      "OAuth client not configured for google-gmail"
    );
  });

  it("handles tokens without expires_in", async () => {
    vi.spyOn(oauth, "exchangeCode").mockResolvedValue({
      access_token: "access-123",
    });
    await handlePluginCallback("google-gmail", "code", "state");
    expect(tokens.storeToken).toHaveBeenCalledWith(
      "user-1",
      "google-gmail",
      expect.objectContaining({
        expiresAt: undefined,
      })
    );
  });
});
