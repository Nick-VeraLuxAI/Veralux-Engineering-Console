import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    watch: {
      ignored: [".next/**", ".next-e2e/**", "playwright-report/**", "test-results/**"],
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/lib/engineer-console/**/*.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    setupFiles: ["src/lib/engineer-console/test-support/vitest-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
