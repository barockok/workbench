// Throwaway: seed a user into the capture DB and print a portal session JWT.
import { db } from "./src/db";
import { signSession } from "./src/auth/session";

const userId = "capture-user";
const email = "capture@example.com";

db.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)").run(userId, email);

signSession({ userId, email }).then((token) => {
  console.log(token);
  process.exit(0);
});
