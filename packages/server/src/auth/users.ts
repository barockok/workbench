import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";

export function createUser(id: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("INSERT INTO users (id, api_key_hash) VALUES (?, ?)").run(id, hash);
  return { apiKey };
}

// Mint (or rotate) the API key for an EXISTING user — Google SSO already
// created the row; this just sets its hash. Returns the plaintext key once;
// only the bcrypt hash is stored, so it can never be shown again.
export function setApiKey(userId: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("UPDATE users SET api_key_hash = ? WHERE id = ?").run(hash, userId);
  return { apiKey };
}

// Revoke: drop the stored hash so the key no longer verifies.
export function clearApiKey(userId: string): void {
  db.prepare("UPDATE users SET api_key_hash = NULL WHERE id = ?").run(userId);
}

export function hasApiKey(userId: string): boolean {
  const row = db.prepare("SELECT api_key_hash FROM users WHERE id = ?").get(userId) as
    | { api_key_hash: string | null }
    | undefined;
  return !!row?.api_key_hash;
}

export function verifyApiKey(apiKey: string): string | null {
  const users = db.prepare("SELECT id, api_key_hash FROM users").all() as { id: string; api_key_hash: string | null }[];
  for (const user of users) {
    if (!user.api_key_hash) continue;
    if (bcrypt.compareSync(apiKey, user.api_key_hash)) {
      return user.id;
    }
  }
  return null;
}

export function getUserById(userId: string): { id: string; email: string | null } | null {
  const row = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId) as
    | { id: string; email: string | null }
    | undefined;
  return row ?? null;
}
