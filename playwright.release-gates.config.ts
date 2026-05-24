import baseConfig from "./playwright.config";
import { E2E_GATES_AUDIT_SCOPE, E2E_GATES_DB_PATH } from "./tests/e2e/env";

/** Use 3000 when running standalone; set E2E_GATES_PORT=3002 if 3000 is busy. */
const port = Number(process.env.E2E_GATES_PORT ?? 3000);

const baseWebServer = baseConfig.webServer;
const baseEnv =
  baseWebServer && typeof baseWebServer === "object" && "env" in baseWebServer
    ? (baseWebServer.env as Record<string, string>)
    : {};

export default {
  ...baseConfig,
  testMatch: ["**/zz-hard-release-gates-smoke.spec.ts"],
  use: {
    ...baseConfig.use,
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    ...baseWebServer,
    command: [
      "npm run engineer-console:init-db",
      "&&",
      "npx next dev --port " + String(port),
    ].join(" "),
    url: `http://127.0.0.1:${port}/engineer`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...baseEnv,
      PORT: String(port),
      NODE_ENV: "development",
      ENGINEER_CONSOLE_DB_PATH: E2E_GATES_DB_PATH,
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "true",
      ENGINEER_CONSOLE_AUTH_ENABLED: "false",
      ENGINEER_CONSOLE_MODEL_PROVIDER: "mock",
      ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE: E2E_GATES_AUDIT_SCOPE,
      ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "true",
      ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON: "[]",
    },
  },
};
