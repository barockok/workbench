// Throwaway: seed a user into the capture DB and print a portal session JWT.
import { db, initDb } from "./src/db";
import { signSession } from "./src/auth/session";

const userId = "capture-user";
const email = "capture@example.com";

(async () => {
  await initDb();
  await db.run("INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT (id) DO NOTHING", [userId, email]);
  const token = await signSession({ userId, email });
  console.log(token);
  process.exit(0);
})();
