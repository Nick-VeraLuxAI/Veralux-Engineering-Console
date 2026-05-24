import { defineConfig, devices } from "@playwright/test";
import { E2E_LOCAL_DB_PATH } from "./tests/e2e/env";

const port = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/engineer-console-smoke.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      "npm run engineer-console:init-db",
      "&&",
      "npx next dev --port " + String(port),
    ].join(" "),
    url: `http://127.0.0.1:${port}/engineer`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      ENGINEER_CONSOLE_DB_PATH: E2E_LOCAL_DB_PATH,
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "true",
      ENGINEER_CONSOLE_AUTH_ENABLED: "false",
      ENGINEER_CONSOLE_MODEL_PROVIDER: "mock",
      ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE: "e2e-smoke-local",
      ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "false",
      ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON: "[]",
    },
  },
});
