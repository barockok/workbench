/**
 * Seed a local user + mint a workbench API key — lets you test without Google
 * SSO (which is only needed for the portal UI). The API key authenticates the
 * REST + MCP endpoints via the `x-workbench-api-key` header.
 *
 * Writes to the same DB the server uses, so run it with the same env:
 *   cd packages/server
 *   npx tsx --env-file=../../.env scripts/seed-local-user.ts [userId]
 *
 * Prints the API key. Re-running for the same userId rotates the key.
 */
import { createUser, setApiKey, getUserById } from "../src/auth/users";
import { initDb } from "../src/db";

(async () => {
  await initDb();
  const id = process.argv[2] ?? "local-dev-user";
  const existing = await getUserById(id);
  const { apiKey } = existing ? await setApiKey(id) : await createUser(id);
  console.log(`user:    ${id}`);
  console.log(`api key: ${apiKey}`);
})();
