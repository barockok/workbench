import { describe, it, expect, beforeEach } from "vitest";
import { createUser, verifyApiKey, setApiKey, clearApiKey, hasApiKey, getApiKey } from "../src/auth/users";
import { db } from "../src/db";

beforeEach(async () => {
  await db.exec("DELETE FROM users");
});

// An existing user (e.g. created via Google SSO) with no api key yet.
async function seedUser(id: string) {
  await db.run("INSERT INTO users (id, email) VALUES (?, ?)", [id, `${id}@x.test`]);
}

describe("users", () => {
  it("creates user with api key", async () => {
    const { apiKey } = await createUser("alice");
    expect(apiKey).toHaveLength(64);
  });

  it("verifies valid api key", async () => {
    const { apiKey } = await createUser("alice");
    const userId = await verifyApiKey(apiKey);
    expect(userId).toBe("alice");
  });

  it("rejects invalid api key", async () => {
    const userId = await verifyApiKey("invalid");
    expect(userId).toBeNull();
  });

  // Rows minted before api_key_sha existed carry only a bcrypt hash. They must
  // keep verifying, and the sha must get backfilled so the next call is indexed.
  it("verifies a legacy bcrypt-only key and backfills its sha", async () => {
    const { apiKey } = await createUser("alice");
    await db.run("UPDATE users SET api_key_sha = NULL WHERE id = ?", ["alice"]);

    expect(await verifyApiKey(apiKey)).toBe("alice");

    const row = await db.get<{ api_key_sha: string | null }>(
      "SELECT api_key_sha FROM users WHERE id = ?",
      ["alice"]
    );
    expect(row?.api_key_sha).toBeTruthy();
    expect(await verifyApiKey(apiKey)).toBe("alice");
  });
});

describe("api key management for existing users", () => {
  it("mints a key for an existing user and verifies it", async () => {
    await seedUser("bob");
    const { apiKey } = await setApiKey("bob");
    expect(apiKey).toHaveLength(64);
    expect(await verifyApiKey(apiKey)).toBe("bob");
    expect(await hasApiKey("bob")).toBe(true);
  });

  it("rotates the key: old key stops working, new key works", async () => {
    await seedUser("bob");
    const { apiKey: first } = await setApiKey("bob");
    const { apiKey: second } = await setApiKey("bob");
    expect(second).not.toBe(first);
    expect(await verifyApiKey(first)).toBeNull();
    expect(await verifyApiKey(second)).toBe("bob");
  });

  it("reports hasApiKey false before minting", async () => {
    await seedUser("bob");
    expect(await hasApiKey("bob")).toBe(false);
  });

  it("revokes the key", async () => {
    await seedUser("bob");
    const { apiKey } = await setApiKey("bob");
    await clearApiKey("bob");
    expect(await hasApiKey("bob")).toBe(false);
    expect(await verifyApiKey(apiKey)).toBeNull();
  });

  it("reveals the same plaintext key it minted", async () => {
    await seedUser("bob");
    const { apiKey } = await setApiKey("bob");
    expect(await getApiKey("bob")).toBe(apiKey);
  });

  it("reveals the key for createUser too", async () => {
    const { apiKey } = await createUser("carol");
    expect(await getApiKey("carol")).toBe(apiKey);
  });

  it("returns null reveal before minting and after revoke", async () => {
    await seedUser("bob");
    expect(await getApiKey("bob")).toBeNull();
    await setApiKey("bob");
    await clearApiKey("bob");
    expect(await getApiKey("bob")).toBeNull();
  });
});
