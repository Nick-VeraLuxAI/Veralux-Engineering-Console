import { describe, expect, it } from "vitest";
import { generateBranchName } from "./git-workspace";

describe("generateBranchName", () => {
  it("creates a safe engineer branch prefix", () => {
    const name = generateBranchName(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "11111111-2222-3333-4444-555555555555",
    );
    expect(name.startsWith("engineer/")).toBe(true);
    expect(name).toMatch(/^engineer\/[a-f0-9]+\/[a-f0-9]+-\d+$/);
  });
});
