import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@qingzhou/protocol": path.resolve(__dirname, "packages/protocol/src/index.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Hosted Windows runners have higher variance in Git subprocess and filesystem I/O.
    testTimeout: process.platform === "win32" ? 45_000 : 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
