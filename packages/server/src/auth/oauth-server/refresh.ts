import crypto from "crypto";
import { db } from "../../db";

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function issueRefreshToken(input: { clientId: string; userId: string; scope: string }): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(hash(token), input.clientId, input.userId, input.scope, now + REFRESH_TTL_SECONDS);
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?").run(now);
  return token;
}

export interface Rotated {
  userId: string;
  scope: string;
  newToken: string;
}

export function rotateRefreshToken(token: string, clientId: string): Rotated | null {
  const now = Math.floor(Date.now() / 1000);
  const h = hash(token);
  const row = db
    .prepare("SELECT client_id, user_id, scope FROM oauth_refresh_tokens WHERE token_hash = ? AND expires_at > ?")
    .get(h, now) as { client_id: string; user_id: string; scope: string } | undefined;
  if (!row) return null;
  // Always invalidate the presented token (rotation).
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?").run(h);
  if (row.client_id !== clientId) return null;
  const newToken = issueRefreshToken({ clientId, userId: row.user_id, scope: row.scope });
  return { userId: row.user_id, scope: row.scope, newToken };
}
