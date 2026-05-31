import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All test files share one real SQLite file (config.DATABASE_URL). Running
    // files in parallel lets one file's `DELETE FROM users` race another file's
    // rows mid-test. Serialize files to keep DB-touching suites deterministic.
    fileParallelism: false,
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
