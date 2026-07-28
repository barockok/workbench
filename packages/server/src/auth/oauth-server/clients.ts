import crypto from "crypto";
import { db } from "../../db";

export interface OAuthClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

export async function registerClient(input: { client_name?: string; redirect_uris: string[] }): Promise<OAuthClient> {
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new Error("redirect_uris must contain at least one URI");
  }
  const client_id = crypto.randomBytes(16).toString("hex");
  await db.run(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)",
    [client_id, input.client_name ?? null, JSON.stringify(input.redirect_uris)]
  );
  return { client_id, client_name: input.client_name, redirect_uris: input.redirect_uris };
}

export async function getClient(clientId: string): Promise<OAuthClient | undefined> {
  const row = await db.get<{ client_id: string; client_name: string | null; redirect_uris: string }>(
    "SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?",
    [clientId]
  );
  if (!row) return undefined;
  return {
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris),
  };
}
