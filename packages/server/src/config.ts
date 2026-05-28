import { z } from "zod";

const configSchema = z.object({
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ENCRYPTION_KEY: z.string().length(64).default(
    process.env.NODE_ENV === "test"
      ? "0000000000000000000000000000000000000000000000000000000000000000"
      : ""
  ),
  DATABASE_URL: z.string().default("./data/tokens.db"),
  PLUGINS_DIR: z.string().default("./plugins"),
  AUDIT_LOG_DEST: z.enum(["sqlite", "stdout", "kafka"]).default("sqlite"),
  AUDIT_LOG_KAFKA_BROKERS: z.string().optional(),
  AUDIT_LOG_KAFKA_TOPIC: z.string().default("audit-log"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PLUGIN_CLIENT_ID: z.string().optional(),
  GOOGLE_PLUGIN_CLIENT_SECRET: z.string().optional(),
  SERVER_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32).default(
    process.env.NODE_ENV === "test"
      ? "test-session-secret-32-chars-long!!"
      : ""
  ),
  PORTAL_URL: z.string().url().default("http://localhost:5173"),
});

export const config = configSchema.parse(process.env);
