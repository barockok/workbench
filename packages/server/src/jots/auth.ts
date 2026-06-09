import crypto from "node:crypto";

// Password hashing: scrypt, self-describing string "scrypt$<saltHex>$<hashHex>".
const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Per-jot cookie token: HMAC(secret, jotName). Self-verifying, no session store.
export function makeToken(secret: string, jotName: string): string {
  return crypto.createHmac("sha256", secret).update(jotName).digest("hex");
}

export function verifyToken(secret: string, jotName: string, token: string): boolean {
  if (typeof token !== "string") return false;
  const expected = makeToken(secret, jotName);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieName(jotName: string): string {
  return `jot_${jotName}`;
}
