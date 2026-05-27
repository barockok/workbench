import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";

const dbDir = path.dirname(config.DATABASE_URL);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.DATABASE_URL);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT,
    email TEXT UNIQUE,
    google_sub TEXT UNIQUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    integration TEXT NOT NULL,
    access_token BLOB NOT NULL,
    refresh_token BLOB,
    expires_at INTEGER,
    scopes TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, integration)
  );

  CREATE TABLE IF NOT EXISTS pending_auth (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    integration TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    integration TEXT,
    tool TEXT,
    action TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error TEXT,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_integration ON audit_log(integration, created_at);
`);

// Migrations
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column name")) throw e;
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column name")) throw e;
}
