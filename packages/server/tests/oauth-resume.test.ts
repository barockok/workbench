import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { db } from "../src/db";
import { resumeAuthorize } from "../src/auth/oauth-server/resume";
import { consumeCode } from "../src/auth/oauth-server/codes";

beforeEach(async () => {
  await db.exec("DELETE FROM pending_auth");
  await db.exec("DELETE FROM oauth_auth_codes");
});

function seedTicket(ticket: string, binding: string) {
  const now = Math.floor(Date.now() / 1000);
  return db.run("INSERT INTO pending_auth (state, user_id, integration, expires_at, session_data) VALUES (?,?,?,?,?)", [
    ticket,
    "",
    "__oauth_authorize__",
    now + 600,
    JSON.stringify({
      clientId: "c1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: crypto.createHash("sha256").update("v").digest("base64url"),
      scope: "mcp", state: "st", resource: "http://x/mcp", binding,
    }),
  ]);
}

describe("resumeAuthorize", () => {
  it("mints a usable code when the binding matches", async () => {
    await seedTicket("tkt1", "bind-secret");
    const url = await resumeAuthorize("tkt1", "user-9", "bind-secret");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1\/cb\?/);
    const code = new URL(url!).searchParams.get("code")!;
    expect(new URL(url!).searchParams.get("state")).toBe("st");
    const consumed = await consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "v" });
    expect(consumed?.userId).toBe("user-9");
  });

  it("refuses (null) when the binding does not match", async () => {
    await seedTicket("tkt2", "real-binding");
    expect(await resumeAuthorize("tkt2", "user-9", "attacker-binding")).toBeNull();
    // the pending row must be consumed so it can't be retried
    const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pending_auth WHERE state = 'tkt2'");
    expect(Number(row?.n)).toBe(0);
  });

  it("refuses (null) when no binding is provided", async () => {
    await seedTicket("tkt3", "real-binding");
    expect(await resumeAuthorize("tkt3", "user-9", undefined)).toBeNull();
  });

  it("returns null for a missing ticket", async () => {
    expect(await resumeAuthorize("missing", "u", "x")).toBeNull();
  });
});
