import crypto from "crypto";
import { db } from "../db";

export function createAuthState(userId: string, integration: string): string {
  const state = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO pending_auth (state, user_id, integration, expires_at) VALUES (?, ?, ?, ?)")
    .run(state, userId, integration, Math.floor(Date.now() / 1000) + 600);

  db.prepare("DELETE FROM pending_auth WHERE expires_at < ?").run(Math.floor(Date.now() / 1000));

  return state;
}

export function verifyAuthState(state: string): { userId: string; integration: string } | null {
  const row = db.prepare("SELECT user_id, integration FROM pending_auth WHERE state = ? AND expires_at > ?")
    .get(state, Math.floor(Date.now() / 1000)) as { user_id: string; integration: string } | undefined;

  if (!row) return null;

  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);
  return { userId: row.user_id, integration: row.integration };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  // Slack-specific: ok/error envelope, user token nested under authed_user
  ok?: boolean;
  error?: string;
  authed_user?: {
    id?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

export async function exchangeCode(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json();
}
