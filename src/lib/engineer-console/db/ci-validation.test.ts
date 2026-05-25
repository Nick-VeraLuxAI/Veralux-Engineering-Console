import { describe, expect, it } from "vitest";
import {
  VERIFY_CI_EXPECTED_RUNTIME,
  VERIFY_CI_STEPS,
} from "../../../../scripts/verify-engineer-console-ci.mjs";

describe("verify-engineer-console-ci contract", () => {
  it("defines the expected ordered validation commands", () => {
    expect(VERIFY_CI_STEPS.map((s) => s.command)).toEqual([
      "npm test",
      "npm run build",
      "npm run test:e2e",
      "npm run test:e2e:gates",
      "npm run test:e2e:auth",
      "npm run backup:db:verify",
    ]);
  });

  it("documents expected runtime for operators", () => {
    expect(VERIFY_CI_EXPECTED_RUNTIME).toMatch(/minute/i);
  });

  it("includes backup verification as the final step", () => {
    expect(VERIFY_CI_STEPS[VERIFY_CI_STEPS.length - 1]?.id).toBe("backup-verify");
  });
});
