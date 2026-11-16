import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";
import { testDatabaseUrl } from "./tests/test-db";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // Workers get the sibling *_test database, never the app's own.
    env: { DATABASE_URL: testDatabaseUrl(process.env.DATABASE_URL) },
    // API tests share one real Postgres table, so run files one at a time.
    fileParallelism: false,
  },
});
