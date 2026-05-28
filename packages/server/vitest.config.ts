import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
