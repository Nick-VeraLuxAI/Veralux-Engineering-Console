import { describe, expect, it } from "vitest";
import {
  getGovernanceModeConfig,
  governanceModeDirectorCopy,
  resolveGovernanceMode,
} from "./governance-mode";

describe("governance-mode", () => {
  it("defaults to build when release gates are off", () => {
    expect(resolveGovernanceMode({})).toBe("build");
    expect(getGovernanceModeConfig({}).continueEngineeringResumesAe).toBe(true);
  });

  it("defaults to release when hard release gates are enabled", () => {
    expect(
      resolveGovernanceMode({ ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "true" }),
    ).toBe("release");
    expect(
      getGovernanceModeConfig({ ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "true" })
        .continueEngineeringResumesAe,
    ).toBe(false);
  });

  it("honors explicit ENGINEER_CONSOLE_GOVERNANCE_MODE", () => {
    expect(
      resolveGovernanceMode({
        ENGINEER_CONSOLE_GOVERNANCE_MODE: "observe",
        ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "true",
      }),
    ).toBe("observe");
    expect(
      getGovernanceModeConfig({ ENGINEER_CONSOLE_GOVERNANCE_MODE: "build" })
        .preferSandboxAfterApprove,
    ).toBe(true);
  });

  it("labels Continue engineering in build mode", () => {
    const copy = governanceModeDirectorCopy("build");
    expect(copy.continueLabel).toBe("Continue engineering");
    expect(copy.approveLabel).toBe("Accept delivery");
  });
});
