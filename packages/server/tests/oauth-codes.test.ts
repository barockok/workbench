import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { issueCode, consumeCode } from "../src/auth/oauth-server/codes";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_auth_codes"));

function challenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

describe("oauth auth codes", () => {
  it("issues then consumes once with correct PKCE verifier", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("verifier123"), scope: "mcp", resource: "http://x/mcp",
    });
    const ok = consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "verifier123" });
    expect(ok?.userId).toBe("u1");
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "verifier123" })).toBeNull();
  });

  it("rejects a wrong PKCE verifier", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("right"), scope: "mcp", resource: "http://x/mcp",
    });
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "wrong" })).toBeNull();
  });

  it("rejects a redirect_uri mismatch", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("v"), scope: "mcp", resource: "http://x/mcp",
    });
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://evil/cb", codeVerifier: "v" })).toBeNull();
  });
});
