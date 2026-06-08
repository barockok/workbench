import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export function createUser(id: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("INSERT INTO users (id, api_key_hash, api_key_enc) VALUES (?, ?, ?)").run(
    id,
    hash,
    encrypt(apiKey)
  );
  return { apiKey };
}

// Mint (or rotate) the API key for an EXISTING user — Google SSO already
// created the row; this just sets its hash. The bcrypt hash verifies the key;
// an encrypted copy is stored so the key can be revealed again later.
export function setApiKey(userId: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("UPDATE users SET api_key_hash = ?, api_key_enc = ? WHERE id = ?").run(
    hash,
    encrypt(apiKey),
    userId
  );
  return { apiKey };
}

// Reveal the stored plaintext key (decrypted). Null if no key set.
export function getApiKey(userId: string): string | null {
  const row = db.prepare("SELECT api_key_enc FROM users WHERE id = ?").get(userId) as
    | { api_key_enc: Buffer | null }
    | undefined;
  if (!row?.api_key_enc) return null;
  return decrypt(row.api_key_enc);
}

// Revoke: drop the stored hash + encrypted copy so the key no longer verifies.
export function clearApiKey(userId: string): void {
  db.prepare("UPDATE users SET api_key_hash = NULL, api_key_enc = NULL WHERE id = ?").run(userId);
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
