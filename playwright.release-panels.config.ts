import baseConfig from "./playwright.config";

/** Release panels only (same webServer prep as playwright.config.ts). */
export default {
  ...baseConfig,
  testMatch: ["**/zz-release-panels-smoke.spec.ts"],
};
