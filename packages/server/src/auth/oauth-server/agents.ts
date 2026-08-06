import { db } from "../../db";

export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];
  connected_since: number;
  expires_at: number;
}

export async function listAgents(userId: string): Promise<ConnectedAgent[]> {
  const now = Math.floor(Date.now() / 1000);
  // GROUP_CONCAT (SQLite) vs STRING_AGG (PostgreSQL)
  const groupConcat =
    db.dialect === "postgres"
      ? "STRING_AGG(rt.scope, ' ')"
      : "GROUP_CONCAT(rt.scope, ' ')";
  const rows = await db.all<{
    client_id: string;
    client_name: string | null;
    scopes: string | null;
    connected_since: number | null;
    expires_at: number;
  }>(
    `SELECT rt.client_id            AS client_id,
            c.client_name           AS client_name,
            ${groupConcat}          AS scopes,
            MIN(rt.created_at)      AS connected_since,
            MAX(rt.expires_at)      AS expires_at
       FROM oauth_refresh_tokens rt
       LEFT JOIN oauth_clients c ON c.client_id = rt.client_id
      WHERE rt.user_id = ? AND rt.expires_at > ?
      GROUP BY rt.client_id, c.client_name
      ORDER BY connected_since DESC`,
    [userId, now]
  );

  return rows.map((r) => ({
    client_id: r.client_id,
    client_name: r.client_name ?? undefined,
    scopes: Array.from(new Set((r.scopes ?? "").split(/\s+/).filter(Boolean))).sort(),
    connected_since: r.connected_since ?? 0,
    expires_at: r.expires_at,
  }));
}

export async function revokeAgent(userId: string, clientId: string): Promise<number> {
  const { changes } = await db.run(
    "DELETE FROM oauth_refresh_tokens WHERE user_id = ? AND client_id = ?",
    [userId, clientId]
  );
  await db.run("DELETE FROM oauth_auth_codes WHERE user_id = ? AND client_id = ?", [userId, clientId]);
  return changes;
}
