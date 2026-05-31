import crypto from "crypto";
import { db } from "../../db";

const CODE_TTL_SECONDS = 60;

export interface IssueCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string; // S256, base64url
  scope: string;
  resource: string;
}

export function issueCode(input: IssueCodeInput): string {
  const code = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.scope, input.resource, now + CODE_TTL_SECONDS);
  db.prepare("DELETE FROM oauth_auth_codes WHERE expires_at < ?").run(now);
  return code;
}

export interface ConsumeCodeInput {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface ConsumedCode {
  userId: string;
  scope: string;
  resource: string;
}

export function consumeCode(code: string, input: ConsumeCodeInput): ConsumedCode | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT * FROM oauth_auth_codes WHERE code = ? AND expires_at > ?")
    .get(code, now) as
    | { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string }
    | undefined;
  // Single-use: delete on any lookup hit, success or not.
  if (row) db.prepare("DELETE FROM oauth_auth_codes WHERE code = ?").run(code);
  if (!row) return null;
  if (row.client_id !== input.clientId) return null;
  if (row.redirect_uri !== input.redirectUri) return null;
  const computed = crypto.createHash("sha256").update(input.codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(row.code_challenge);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { userId: row.user_id, scope: row.scope, resource: row.resource };
}
