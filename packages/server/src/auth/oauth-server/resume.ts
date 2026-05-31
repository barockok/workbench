import crypto from "crypto";
import { db } from "../../db";
import { issueCode } from "./codes";

// Given a resume ticket (stored by /authorize), the now-authenticated user, and
// the originating-browser binding secret (delivered via httpOnly cookie), mint
// an auth code and return the client redirect URL. null if no such ticket or if
// the binding does not match (prevents login CSRF / auth-code injection).
export function resumeAuthorize(ticket: string, userId: string, binding?: string): string | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT session_data FROM pending_auth WHERE state = ? AND integration = '__oauth_authorize__' AND expires_at > ?")
    .get(ticket, now) as { session_data: string } | undefined;
  if (!row) return null;
  // Single-use: consume the pending row regardless of outcome so it can't be retried.
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(ticket);
  const r = JSON.parse(row.session_data) as {
    clientId: string; redirectUri: string; codeChallenge: string; scope: string; state: string; resource: string; binding: string;
  };
  // Require the originating-browser binding to match (prevents login CSRF).
  if (!binding) return null;
  const a = Buffer.from(binding);
  const b = Buffer.from(r.binding ?? "");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const code = issueCode({
    clientId: r.clientId, userId, redirectUri: r.redirectUri,
    codeChallenge: r.codeChallenge, scope: r.scope, resource: r.resource,
  });
  const url = new URL(r.redirectUri);
  url.searchParams.set("code", code);
  if (r.state) url.searchParams.set("state", r.state);
  return url.toString();
}
