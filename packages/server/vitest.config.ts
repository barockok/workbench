import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All test files share one real SQLite file (config.DATABASE_URL). Running
    // files in parallel lets one file's `DELETE FROM users` race another file's
    // rows mid-test. Serialize files to keep DB-touching suites deterministic.
    fileParallelism: false,
    // Schema creation moved from a `src/db` import side effect into initDb();
    // without this, a fresh checkout has no tables and every DB suite fails.
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        "src/index.ts",
        "src/gap/**",
        "src/telemetry/**",
        "src/audit/logger.ts",
        "**/*.d.ts",
        "**/*.test.ts",
        "tests/**",
      ],
    },
  },
});
