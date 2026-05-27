import { z } from "zod";

const configSchema = z.object({
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  ENCRYPTION_KEY: z.string().length(64),
  DATABASE_URL: z.string().default("./data/tokens.db"),
  PLUGINS_DIR: z.string().default("./plugins"),
  AUDIT_LOG_DEST: z.enum(["sqlite", "stdout", "kafka"]).default("sqlite"),
  AUDIT_LOG_KAFKA_BROKERS: z.string().optional(),
  AUDIT_LOG_KAFKA_TOPIC: z.string().default("audit-log"),
});

export const config = configSchema.parse(process.env);
