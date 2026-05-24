import baseConfig from "./playwright.config";

export default {
  ...baseConfig,
  testMatch: ["**/zz-release-panels-smoke.spec.ts"],
};
