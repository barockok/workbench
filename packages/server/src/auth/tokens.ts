import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string;
  config?: string;
}

export async function storeToken(userId: string, integration: string, data: TokenData): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // COALESCE keeps an existing config when a refresh re-stores without one,
  // so a token rotation never wipes the chosen instance origin.
  await db.run(
    `INSERT INTO connections (user_id, integration, access_token, refresh_token, expires_at, scopes, config)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, integration) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       scopes = excluded.scopes,
       config = COALESCE(excluded.config, connections.config),
       updated_at = ?`,
    [
      userId,
      integration,
      encrypt(data.accessToken),
      data.refreshToken ? encrypt(data.refreshToken) : null,
      data.expiresAt ?? null,
      data.scopes,
      data.config ?? null,
      now,
    ]
  );
}

export async function getConnectionConfig(userId: string, integration: string): Promise<string | null> {
  const row = await db.get<{ config: string | null }>(
    "SELECT config FROM connections WHERE user_id = ? AND integration = ?",
    [userId, integration]
  );
  return row?.config ?? null;
}

export async function getToken(userId: string, integration: string): Promise<TokenData | null> {
  const row = await db.get<{
    access_token: Buffer;
    refresh_token: Buffer | null;
    expires_at: number | null;
    scopes: string;
    config: string | null;
  }>("SELECT * FROM connections WHERE user_id = ? AND integration = ?", [userId, integration]);

  if (!row) return null;

  return {
    accessToken: decrypt(row.access_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    expiresAt: row.expires_at ?? undefined,
    scopes: row.scopes,
    config: row.config ?? undefined,
  };
}

export async function deleteToken(userId: string, integration: string): Promise<void> {
  await db.run("DELETE FROM connections WHERE user_id = ? AND integration = ?", [userId, integration]);
}

export async function hasConnection(userId: string, integration: string): Promise<boolean> {
  const row = await db.get<{ 1: number }>(
    "SELECT 1 FROM connections WHERE user_id = ? AND integration = ? AND (access_token IS NOT NULL OR cookies IS NOT NULL)",
    [userId, integration]
  );
  return !!row;
}
