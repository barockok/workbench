import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string;
  // Per-connection config JSON (e.g. self-hosted instance origin). Optional and
  // preserved across token refresh so it survives a re-store.
  config?: string;
}

export function storeToken(userId: string, integration: string, data: TokenData): void {
  // COALESCE keeps an existing config when a refresh re-stores without one,
  // so a token rotation never wipes the chosen instance origin.
  const stmt = db.prepare(`
    INSERT INTO connections (user_id, integration, access_token, refresh_token, expires_at, scopes, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, integration) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      config = COALESCE(excluded.config, connections.config),
      updated_at = unixepoch()
  `);
  stmt.run(
    userId,
    integration,
    encrypt(data.accessToken),
    data.refreshToken ? encrypt(data.refreshToken) : null,
    data.expiresAt ?? null,
    data.scopes,
    data.config ?? null
  );
}

/** Read the plaintext per-connection config JSON, or null if none stored. */
export function getConnectionConfig(userId: string, integration: string): string | null {
  const row = db
    .prepare("SELECT config FROM connections WHERE user_id = ? AND integration = ?")
    .get(userId, integration) as { config: string | null } | undefined;
  return row?.config ?? null;
}

export function getToken(userId: string, integration: string): TokenData | null {
  const row = db.prepare("SELECT * FROM connections WHERE user_id = ? AND integration = ?").get(userId, integration) as {
    access_token: Buffer;
    refresh_token: Buffer | null;
    expires_at: number | null;
    scopes: string;
    config: string | null;
  } | undefined;

  if (!row) return null;

  return {
    accessToken: decrypt(row.access_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    expiresAt: row.expires_at ?? undefined,
    scopes: row.scopes,
    config: row.config ?? undefined,
  };
}

export function deleteToken(userId: string, integration: string): void {
  db.prepare("DELETE FROM connections WHERE user_id = ? AND integration = ?").run(userId, integration);
}

export function hasConnection(userId: string, integration: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM connections WHERE user_id = ? AND integration = ? AND (access_token IS NOT NULL OR cookies IS NOT NULL)"
  ).get(userId, integration) as { 1: number } | undefined;
  return !!row;
}
