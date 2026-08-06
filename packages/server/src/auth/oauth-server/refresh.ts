import crypto from "crypto";
import { db } from "../../db";
import type { DbExecutor } from "../../db-adapter";

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(
  input: {
    clientId: string;
    userId: string;
    scope: string;
    createdAt?: number;
  },
  /** Pass the transaction's executor when issuing as part of a rotation. */
  executor: DbExecutor = db
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  await executor.run(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [hash(token), input.clientId, input.userId, input.scope, now + REFRESH_TTL_SECONDS, input.createdAt ?? now]
  );
  await executor.run("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?", [now]);
  return token;
}

export interface Rotated {
  userId: string;
  scope: string;
  newToken: string;
}

/**
 * Consume a refresh token and issue its replacement.
 *
 * Single-use is enforced by the DELETE's row count, not by the preceding
 * SELECT. Two concurrent presentations of the same token both see the row in
 * their SELECT; only one DELETE can report `changes === 1`, and the loser
 * returns null instead of minting a second valid token. The whole sequence
 * runs in one transaction so the replacement lands atomically with the
 * consumption — on PostgreSQL these would otherwise be three round trips over
 * three different pooled connections.
 */
export async function rotateRefreshToken(token: string, clientId: string): Promise<Rotated | null> {
  const now = Math.floor(Date.now() / 1000);
  const h = hash(token);
  return db.transaction(async (tx) => {
    const row = await tx.get<{ client_id: string; user_id: string; scope: string; created_at: number | null }>(
      "SELECT client_id, user_id, scope, created_at FROM oauth_refresh_tokens WHERE token_hash = ? AND expires_at > ?",
      [h, now]
    );
    if (!row) return null;
    const { changes } = await tx.run("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?", [h]);
    if (changes !== 1) return null;
    // Presenting another client's token still burns it — the DELETE above is
    // committed even on this path. Deliberate: a stolen token is spent once.
    if (row.client_id !== clientId) return null;
    const newToken = await issueRefreshToken(
      {
        clientId,
        userId: row.user_id,
        scope: row.scope,
        createdAt: row.created_at ?? now,
      },
      tx
    );
    return { userId: row.user_id, scope: row.scope, newToken };
  });
}
