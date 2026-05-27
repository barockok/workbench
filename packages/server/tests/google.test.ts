import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildAuthUrl } from "../src/auth/google";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM users");
  vi.restoreAllMocks();
});

describe("google auth", () => {
  it("builds auth URL with correct params", () => {
    const url = buildAuthUrl("random-state");
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBe("random-state");
    expect(parsed.searchParams.get("scope")).toContain("openid");
    expect(parsed.searchParams.get("redirect_uri")).toContain("/auth/google/callback");
  });
});
