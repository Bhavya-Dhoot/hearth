import { defineConfig } from "vitest/config";

export default defineConfig({
  // cdk.out holds staged copies of the whole repo (Docker assets); never collect their tests.
  test: { include: ["test/**/*.test.ts"], exclude: ["**/node_modules/**", "cdk.out/**"] },
});
