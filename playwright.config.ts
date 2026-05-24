import { defineConfig, devices } from "@playwright/test";
import path from "path";

const port = Number(process.env.E2E_PORT ?? 3000);
const dbPath = path.join(__dirname, "data", "e2e-local.db");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/engineer-console-smoke.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run engineer-console:init-db && npm run dev -- --port " + String(port),
    url: `http://127.0.0.1:${port}/engineer`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      PORT: String(port),
      ENGINEER_CONSOLE_DB_PATH: dbPath,
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "true",
      ENGINEER_CONSOLE_AUTH_ENABLED: "false",
      ENGINEER_CONSOLE_MODEL_PROVIDER: "mock",
      ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE: "e2e-smoke-local",
      ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "false",
    },
  },
});
