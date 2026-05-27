import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";

export function createUser(id: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("INSERT INTO users (id, api_key_hash) VALUES (?, ?)").run(id, hash);
  return { apiKey };
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
