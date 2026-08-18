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
  KEYCLOAK_ISSUER_URL: z.string().url().optional(),
  KEYCLOAK_CLIENT_ID: z.string().optional(),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),
  SERVER_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32).default(
    process.env.NODE_ENV === "test"
      ? "test-session-secret-32-chars-long!!"
      : ""
  ),
  PORTAL_URL: z.string().url().default("http://localhost:5173"),
  PORTAL_DIST_DIR: z.string().default("./portal"),
  CONNECT_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  BROWSER_PROFILES_DIR: z.string().optional(),
  BROWSER_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Whole-profile deletion after this many days unused. Deleting a profile logs
  // that user out of every cookie-auth integration, so it is deliberately far
  // more conservative than the cache trim, which costs nothing. 0 = never.
  BROWSER_PROFILE_TTL_DAYS: z.coerce.number().int().nonnegative().default(30),
  BROWSER_PROFILE_REAP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
  BROWSER_DISK_CACHE_MB: z.coerce.number().int().nonnegative().default(32),
  JOTS_DIR: z.string().optional(),
  JOTS_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
  JOTS_MAX_FILES: z.coerce.number().int().positive().default(1000),
  JOTS_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Maximum connections per worker pool. With CLUSTER_ENABLED the total
  // connection count is PG_POOL_MAX × worker count — keep this low enough
  // that (workers × PG_POOL_MAX) stays well under Postgres max_connections.
  PG_POOL_MAX: z.coerce.number().int().positive().default(2),
  // Milliseconds to wait for a free pool slot before rejecting. 0 = unlimited.
  PG_CONNECT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5000),
  // Enable cluster mode — forks os.availableParallelism() worker processes.
  // Requires a PostgreSQL DATABASE_URL — SQLite cannot be shared across processes.
  CLUSTER_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Per-block MCP content[] wire cap. Part count is derived as
  // floor(MAX_OVERFLOW_TOKENS / MAX_RESULT_CHARS), so changing this size
  // does not require retuning the token budget.
  MAX_RESULT_CHARS: z.coerce.number().int().min(3_000).default(60_000),
  // Total character budget per overflowed payload (same units as MAX_RESULT_CHARS).
  // Default 300000 / 60000 = 5 parts, matching the old MAX_OVERFLOW_PARTS=5.
  MAX_OVERFLOW_TOKENS: z.coerce.number().int().positive().default(300_000),
  // Max oversized execute_tools results[] items that get eager multi-content
  // parts in the same tools/call. Further overflowed items are still stored +
  // stubbed; the agent fetches them via continue_tool_result.
  MAX_OVERFLOW_ITEMS: z.coerce.number().int().positive().default(2),
}).refine((c) => c.MAX_OVERFLOW_TOKENS >= c.MAX_RESULT_CHARS, {
  message: "MAX_OVERFLOW_TOKENS must be >= MAX_RESULT_CHARS",
  path: ["MAX_OVERFLOW_TOKENS"],
});

export const config = configSchema.parse(process.env);
