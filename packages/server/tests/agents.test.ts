import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { db } from "../src/db";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";
import { listAgents, revokeAgent } from "../src/auth/oauth-server/agents";

function rowFor(token: string) {
  const h = crypto.createHash("sha256").update(token).digest("hex");
  return db
    .prepare("SELECT user_id, client_id, created_at FROM oauth_refresh_tokens WHERE token_hash = ?")
    .get(h) as { user_id: string; client_id: string; created_at: number } | undefined;
}

function seedClient(clientId: string, name: string) {
  db.prepare(
    "INSERT OR REPLACE INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)"
  ).run(clientId, name, JSON.stringify(["https://x/cb"]));
}

function clearAll() {
  db.prepare("DELETE FROM oauth_refresh_tokens").run();
  db.prepare("DELETE FROM oauth_clients").run();
  db.prepare("DELETE FROM oauth_auth_codes").run();
}

describe("refresh token created_at", () => {
  beforeEach(clearAll);

  it("preserves created_at across rotation", () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    const token = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp", createdAt: past });
    const rotated = rotateRefreshToken(token, "c1");
    expect(rotated).not.toBeNull();
    const newRow = rowFor(rotated!.newToken);
    expect(newRow?.created_at).toBe(past);
  });
});

describe("listAgents", () => {
  beforeEach(clearAll);

  it("groups multiple tokens of one client into one agent with union scopes", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp read", createdAt: 100 });
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp write", createdAt: 200 });
    const agents = listAgents("u1");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ client_id: "c1", client_name: "Claude", connected_since: 100 });
    expect(agents[0].scopes).toEqual(["mcp", "read", "write"]);
  });

  it("excludes expired tokens", () => {
    seedClient("c1", "Claude");
    const past = Math.floor(Date.now() / 1000) - 1;
    db.prepare(
      "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("deadhash", "c1", "u1", "mcp", past, past);
    expect(listAgents("u1")).toHaveLength(0);
  });

  it("scopes the list to the requesting user", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" });
    expect(listAgents("u1")).toHaveLength(1);
    expect(listAgents("u2")).toHaveLength(1);
    expect(listAgents("u3")).toHaveLength(0);
  });
});

describe("revokeAgent", () => {
  beforeEach(clearAll);

  it("deletes only the caller's tokens for the target client", () => {
    seedClient("c1", "Claude");
    seedClient("c2", "Cursor");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    issueRefreshToken({ clientId: "c2", userId: "u1", scope: "mcp" }); // other client, same user
    issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" }); // same client, other user
    const deleted = revokeAgent("u1", "c1");
    expect(deleted).toBe(1);
    expect(listAgents("u1").map((a) => a.client_id)).toEqual(["c2"]); // c1 gone, c2 kept
    expect(listAgents("u2").map((a) => a.client_id)).toEqual(["c1"]); // other user untouched
    // shared client row survives
    expect(db.prepare("SELECT client_id FROM oauth_clients WHERE client_id = ?").get("c1")).toBeTruthy();
  });

  it("also deletes in-flight auth codes for that user+client", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    db.prepare(
      "INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("code1", "c1", "u1", "https://x/cb", "chal", "mcp", "res", Math.floor(Date.now() / 1000) + 600);
    revokeAgent("u1", "c1");
    expect(db.prepare("SELECT code FROM oauth_auth_codes WHERE code = ?").get("code1")).toBeUndefined();
  });

  it("returns 0 for a client the user has no tokens for (idempotent)", () => {
    expect(revokeAgent("u1", "nope")).toBe(0);
  });
});
