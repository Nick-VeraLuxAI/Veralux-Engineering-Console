import baseConfig from "./playwright.config";

/** Focused smoke for the read-only run intelligence card. */
export default {
  ...baseConfig,
  testMatch: ["**/zz-run-intelligence-smoke.spec.ts"],
};
