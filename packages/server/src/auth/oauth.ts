import crypto from "crypto";
import { db } from "../db";

// PKCE (RFC 7636): the verifier lives server-side in pending_auth alongside
// the state, since the whole flow is server-brokered (no SPA in the loop).
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function codeChallengeS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function createAuthState(
  userId: string,
  integration: string,
  codeVerifier?: string,
  config?: string
): string {
  const state = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO pending_auth (state, user_id, integration, expires_at, code_verifier, config) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(state, userId, integration, Math.floor(Date.now() / 1000) + 600, codeVerifier ?? null, config ?? null);

  db.prepare("DELETE FROM pending_auth WHERE expires_at < ?").run(Math.floor(Date.now() / 1000));

  return state;
}

export function verifyAuthState(
  state: string
): { userId: string; integration: string; codeVerifier?: string; config?: string } | null {
  const row = db.prepare("SELECT user_id, integration, code_verifier, config FROM pending_auth WHERE state = ? AND expires_at > ?")
    .get(state, Math.floor(Date.now() / 1000)) as
      { user_id: string; integration: string; code_verifier: string | null; config: string | null } | undefined;

  if (!row) return null;

  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);
  return {
    userId: row.user_id,
    integration: row.integration,
    codeVerifier: row.code_verifier ?? undefined,
    config: row.config ?? undefined,
  };
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
  clientSecret: string | undefined,
  code: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<TokenResponse> {
  // Public (PKCE-only) clients have no secret; Keycloak rejects an empty
  // client_secret param, so omit it entirely rather than send "".
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const response = await fetch(tokenUrl, {
    method: "POST",
    // GitHub's token endpoint defaults to a form-urlencoded response body;
    // Accept: application/json forces JSON so response.json() doesn't choke.
    // Other providers (Google/Atlassian) return JSON regardless and ignore it.
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json();
}
