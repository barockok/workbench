import { db } from "../../db";

export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];
  connected_since: number; // unix seconds, MIN(created_at)
  expires_at: number;      // unix seconds, MAX(expires_at)
}

// List the user's connected agents — one row per client_id, aggregated from
// their non-expired refresh tokens. `scopes` is the union of the space-
// delimited scope strings across the grouped rows. Newest agents first.
export function listAgents(userId: string): ConnectedAgent[] {
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      `SELECT rt.client_id            AS client_id,
              c.client_name           AS client_name,
              GROUP_CONCAT(rt.scope, ' ') AS scopes,
              MIN(rt.created_at)      AS connected_since,
              MAX(rt.expires_at)      AS expires_at
         FROM oauth_refresh_tokens rt
         LEFT JOIN oauth_clients c ON c.client_id = rt.client_id
        WHERE rt.user_id = ? AND rt.expires_at > ?
        GROUP BY rt.client_id
        ORDER BY connected_since DESC`
    )
    .all(userId, now) as {
    client_id: string;
    client_name: string | null;
    scopes: string | null;
    connected_since: number | null;
    expires_at: number;
  }[];

  return rows.map((r) => ({
    client_id: r.client_id,
    client_name: r.client_name ?? undefined,
    scopes: Array.from(
      new Set((r.scopes ?? "").split(/\s+/).filter(Boolean))
    ).sort(),
    connected_since: r.connected_since ?? 0,
    expires_at: r.expires_at,
  }));
}

// Revoke an agent: delete this user's refresh tokens for that client and any
// in-flight authorization codes. Soft revoke — already-issued access JWTs lapse
// at their own TTL. Never touches the shared oauth_clients row or other users'
// rows. Returns the number of refresh-token rows deleted (0 if none — idempotent).
export function revokeAgent(userId: string, clientId: string): number {
  // better-sqlite3 runs synchronously; these two scoped deletes need no explicit
  // transaction (and the rest of the codebase doesn't use one). Revoke is
  // idempotent, so a partial run is safely retryable.
  const info = db
    .prepare("DELETE FROM oauth_refresh_tokens WHERE user_id = ? AND client_id = ?")
    .run(userId, clientId);
  db.prepare("DELETE FROM oauth_auth_codes WHERE user_id = ? AND client_id = ?").run(userId, clientId);
  return info.changes as number;
}
