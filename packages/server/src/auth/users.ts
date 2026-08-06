import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { encrypt, decrypt } from "./encryption";

export async function createUser(id: string): Promise<{ apiKey: string }> {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  await db.run("INSERT INTO users (id, api_key_hash, api_key_enc) VALUES (?, ?, ?)", [
    id,
    hash,
    encrypt(apiKey),
  ]);
  return { apiKey };
}

export async function setApiKey(userId: string): Promise<{ apiKey: string }> {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  await db.run("UPDATE users SET api_key_hash = ?, api_key_enc = ? WHERE id = ?", [
    hash,
    encrypt(apiKey),
    userId,
  ]);
  return { apiKey };
}

export async function getApiKey(userId: string): Promise<string | null> {
  const row = await db.get<{ api_key_enc: Buffer | null }>(
    "SELECT api_key_enc FROM users WHERE id = ?",
    [userId]
  );
  if (!row?.api_key_enc) return null;
  return decrypt(row.api_key_enc);
}

export async function clearApiKey(userId: string): Promise<void> {
  await db.run("UPDATE users SET api_key_hash = NULL, api_key_enc = NULL WHERE id = ?", [userId]);
}

export async function hasApiKey(userId: string): Promise<boolean> {
  const row = await db.get<{ api_key_hash: string | null }>(
    "SELECT api_key_hash FROM users WHERE id = ?",
    [userId]
  );
  return !!row?.api_key_hash;
}

export async function verifyApiKey(apiKey: string): Promise<string | null> {
  const users = await db.all<{ id: string; api_key_hash: string | null }>(
    "SELECT id, api_key_hash FROM users"
  );
  for (const user of users) {
    if (!user.api_key_hash) continue;
    if (bcrypt.compareSync(apiKey, user.api_key_hash)) {
      return user.id;
    }
  }
  return null;
}

export async function getUserById(userId: string): Promise<{ id: string; email: string | null } | null> {
  const row = await db.get<{ id: string; email: string | null }>(
    "SELECT id, email FROM users WHERE id = ?",
    [userId]
  );
  return row ?? null;
}
