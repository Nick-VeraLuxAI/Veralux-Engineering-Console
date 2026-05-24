import { defineConfig, devices } from "@playwright/test";
import path from "path";

const port = Number(process.env.E2E_AUTH_PORT ?? 3001);
const dbPath = path.join(__dirname, "data", "e2e-auth.db");

/** bcrypt hash for password `e2e-test-pass` (cost 12). */
const E2E_ADMIN_PASSWORD_HASH =
  "$2b$12$8EztiZvZFDXhdap.WTdUAOrCLGWE4qAk7uCIIFqSExnMkksPWhODm";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/auth-smoke.spec.ts",
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
    command: [
      "npm run engineer-console:init-db",
      "&&",
      "npm run build",
      "&&",
      `npx next start -p ${port}`,
    ].join(" "),
    url: `http://127.0.0.1:${port}/engineer/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      ENGINEER_CONSOLE_DB_PATH: dbPath,
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "false",
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_SESSION_SECRET: "e2e-playwright-session-secret-min-32-chars",
      ENGINEER_CONSOLE_ADMIN_EMAIL: "e2e@local.test",
      ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH: E2E_ADMIN_PASSWORD_HASH,
      ENGINEER_CONSOLE_MODEL_PROVIDER: "mock",
      ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE: "e2e-smoke-auth",
      ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "false",
    },
  },
});
