import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { db } from "../src/db";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";
import { listAgents, revokeAgent } from "../src/auth/oauth-server/agents";

function rowFor(token: string) {
  const h = crypto.createHash("sha256").update(token).digest("hex");
  return db.get<{ user_id: string; client_id: string; created_at: number }>(
    "SELECT user_id, client_id, created_at FROM oauth_refresh_tokens WHERE token_hash = ?",
    [h]
  );
}

function seedClient(clientId: string, name: string) {
  return db.run("INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)", [
    clientId,
    name,
    JSON.stringify(["https://x/cb"]),
  ]);
}

async function clearAll() {
  await db.run("DELETE FROM oauth_refresh_tokens");
  await db.run("DELETE FROM oauth_clients");
  await db.run("DELETE FROM oauth_auth_codes");
}

describe("refresh token created_at", () => {
  beforeEach(clearAll);

  it("preserves created_at across rotation", async () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    const token = await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp", createdAt: past });
    const rotated = await rotateRefreshToken(token, "c1");
    expect(rotated).not.toBeNull();
    const newRow = await rowFor(rotated!.newToken);
    expect(Number(newRow?.created_at)).toBe(past);
  });
});

describe("listAgents", () => {
  beforeEach(clearAll);

  it("groups multiple tokens of one client into one agent with union scopes", async () => {
    await seedClient("c1", "Claude");
    await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp read", createdAt: 100 });
    await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp write", createdAt: 200 });
    const agents = await listAgents("u1");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ client_id: "c1", client_name: "Claude", connected_since: 100 });
    expect(agents[0].scopes).toEqual(["mcp", "read", "write"]);
  });

  it("excludes expired tokens", async () => {
    await seedClient("c1", "Claude");
    const past = Math.floor(Date.now() / 1000) - 1;
    await db.run(
      "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["deadhash", "c1", "u1", "mcp", past, past]
    );
    expect(await listAgents("u1")).toHaveLength(0);
  });

  it("scopes the list to the requesting user", async () => {
    await seedClient("c1", "Claude");
    await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    await issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" });
    expect(await listAgents("u1")).toHaveLength(1);
    expect(await listAgents("u2")).toHaveLength(1);
    expect(await listAgents("u3")).toHaveLength(0);
  });
});

describe("revokeAgent", () => {
  beforeEach(clearAll);

  it("deletes only the caller's tokens for the target client", async () => {
    await seedClient("c1", "Claude");
    await seedClient("c2", "Cursor");
    await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    await issueRefreshToken({ clientId: "c2", userId: "u1", scope: "mcp" }); // other client, same user
    await issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" }); // same client, other user
    const deleted = await revokeAgent("u1", "c1");
    expect(deleted).toBe(1);
    expect((await listAgents("u1")).map((a) => a.client_id)).toEqual(["c2"]); // c1 gone, c2 kept
    expect((await listAgents("u2")).map((a) => a.client_id)).toEqual(["c1"]); // other user untouched
    // shared client row survives
    expect(await db.get("SELECT client_id FROM oauth_clients WHERE client_id = ?", ["c1"])).toBeTruthy();
  });

  it("also deletes in-flight auth codes for that user+client", async () => {
    await seedClient("c1", "Claude");
    await issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    await db.run(
      "INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["code1", "c1", "u1", "https://x/cb", "chal", "mcp", "res", Math.floor(Date.now() / 1000) + 600]
    );
    await revokeAgent("u1", "c1");
    expect(await db.get("SELECT code FROM oauth_auth_codes WHERE code = ?", ["code1"])).toBeUndefined();
  });

  it("returns 0 for a client the user has no tokens for (idempotent)", async () => {
    expect(await revokeAgent("u1", "nope")).toBe(0);
  });
});
