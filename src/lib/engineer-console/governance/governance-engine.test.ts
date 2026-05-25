import { describe, expect, it } from "vitest";
import { assessChangedFiles } from "./governance-engine";

describe("assessChangedFiles", () => {
  it("returns low risk for safe files", () => {
    const result = assessChangedFiles(["src/foo.ts", "README.md"]);
    expect(result.riskLevel).toBe("low");
    expect(result.canApprove).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("blocks .env changes", () => {
    const result = assessChangedFiles([".env"]);
    expect(result.riskLevel).toBe("blocked");
    expect(result.canApprove).toBe(false);
    expect(result.blockedFiles).toContain(".env");
  });

  it("flags package-lock unless allowed", () => {
    const blocked = assessChangedFiles(["package-lock.json"]);
    expect(blocked.riskLevel).toBe("high");

    const allowed = assessChangedFiles(["package-lock.json"], {
      allowPackageLock: true,
    });
    expect(allowed.riskLevel).toBe("low");
  });

  it("elevates medium risk for large change sets", () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
    const result = assessChangedFiles(files);
    expect(result.riskLevel).toBe("medium");
  });
});
