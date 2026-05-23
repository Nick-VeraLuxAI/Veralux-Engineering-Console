import { describe, expect, it } from "vitest";
import { MockModelProvider } from "./mock-model-provider";

describe("MockModelProvider", () => {
  it("returns valid worker plan JSON", async () => {
    const provider = new MockModelProvider();
    const result = await provider.generateWorkerPlanDraft({
      runId: "run-1",
      taskTitle: "Test",
      taskDescription: "Desc",
      repoPath: "/tmp/repo",
      allowedFiles: ["src/mock.ts"],
      repoContextSummary: "ctx",
      packageScripts: {},
      existingChangedFiles: [],
      constraints: [],
      maxOperations: 5,
      prompt: "test prompt",
    });

    expect(result.providerName).toBe("mock");
    expect(result.parsedPlan).not.toBeNull();
    expect(result.parsedPlan?.runId).toBe("run-1");
    expect(result.parsedPlan?.allowedFiles).toContain("src/mock.ts");
    expect(result.parseErrors).toHaveLength(0);
  });
});
