import crypto from "crypto";
import { db } from "../../db";

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(input: {
  clientId: string;
  userId: string;
  scope: string;
  createdAt?: number;
}): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  await db.run(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [hash(token), input.clientId, input.userId, input.scope, now + REFRESH_TTL_SECONDS, input.createdAt ?? now]
  );
  await db.run("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?", [now]);
  return token;
}

export interface Rotated {
  userId: string;
  scope: string;
  newToken: string;
}

export async function rotateRefreshToken(token: string, clientId: string): Promise<Rotated | null> {
  const now = Math.floor(Date.now() / 1000);
  const h = hash(token);
  const row = await db.get<{ client_id: string; user_id: string; scope: string; created_at: number | null }>(
    "SELECT client_id, user_id, scope, created_at FROM oauth_refresh_tokens WHERE token_hash = ? AND expires_at > ?",
    [h, now]
  );
  if (!row) return null;
  await db.run("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?", [h]);
  if (row.client_id !== clientId) return null;
  const newToken = await issueRefreshToken({
    clientId,
    userId: row.user_id,
    scope: row.scope,
    createdAt: row.created_at ?? now,
  });
  return { userId: row.user_id, scope: row.scope, newToken };
}
