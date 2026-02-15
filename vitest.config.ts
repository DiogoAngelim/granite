import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/types/**/*.d.ts",
        "src/db/schema.ts",
        "src/index.ts",
        "src/db/client.ts",
        "src/db/migrate.ts",
        "src/db/rollback.ts",
      ],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});