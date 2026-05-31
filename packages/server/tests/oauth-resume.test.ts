import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { db } from "../src/db";
import { resumeAuthorize } from "../src/auth/oauth-server/resume";
import { consumeCode } from "../src/auth/oauth-server/codes";

beforeEach(() => { db.exec("DELETE FROM pending_auth"); db.exec("DELETE FROM oauth_auth_codes"); });

describe("resumeAuthorize", () => {
  it("turns a ticket + userId into a redirect URL carrying a usable code", () => {
    const ticket = "tkt1";
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO pending_auth (state, user_id, integration, expires_at, session_data) VALUES (?,?,?,?,?)")
      .run(ticket, "", "__oauth_authorize__", now + 600, JSON.stringify({
        clientId: "c1", redirectUri: "http://127.0.0.1/cb",
        codeChallenge: crypto.createHash("sha256").update("v").digest("base64url"),
        scope: "mcp", state: "st", resource: "http://x/mcp",
      }));
    const url = resumeAuthorize(ticket, "user-9");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1\/cb\?/);
    const code = new URL(url!).searchParams.get("code")!;
    expect(new URL(url!).searchParams.get("state")).toBe("st");
    const consumed = consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "v" });
    expect(consumed?.userId).toBe("user-9");
  });

  it("returns null for a non-oauth or missing ticket", () => {
    expect(resumeAuthorize("missing", "u")).toBeNull();
  });
});
