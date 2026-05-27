import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string;
}

export function storeToken(userId: string, integration: string, data: TokenData): void {
  const stmt = db.prepare(`
    INSERT INTO connections (user_id, integration, access_token, refresh_token, expires_at, scopes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, integration) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      updated_at = unixepoch()
  `);
  stmt.run(
    userId,
    integration,
    encrypt(data.accessToken),
    data.refreshToken ? encrypt(data.refreshToken) : null,
    data.expiresAt ?? null,
    data.scopes
  );
}

export function getToken(userId: string, integration: string): TokenData | null {
  const row = db.prepare("SELECT * FROM connections WHERE user_id = ? AND integration = ?").get(userId, integration) as {
    access_token: Buffer;
    refresh_token: Buffer | null;
    expires_at: number | null;
    scopes: string;
  } | undefined;

  if (!row) return null;

  return {
    accessToken: decrypt(row.access_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    expiresAt: row.expires_at ?? undefined,
    scopes: row.scopes,
  };
}

export function deleteToken(userId: string, integration: string): void {
  db.prepare("DELETE FROM connections WHERE user_id = ? AND integration = ?").run(userId, integration);
}
