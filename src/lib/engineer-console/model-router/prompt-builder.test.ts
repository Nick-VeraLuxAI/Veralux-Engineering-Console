import { describe, expect, it } from "vitest";
import { buildWorkerPlanPrompt, PROMPT_SAFETY_KEYWORDS } from "./prompt-builder";
import type { GenerateWorkerPlanDraftInput } from "./model-provider-types";

const baseInput: GenerateWorkerPlanDraftInput = {
  runId: "run-abc",
  taskTitle: "Add feature",
  taskDescription: "Implement X",
  repoPath: "/tmp/repo",
  allowedFiles: ["src/a.ts"],
  repoContextSummary: "README present",
  packageScripts: { test: "vitest run" },
  existingChangedFiles: [],
  constraints: ["Keep changes minimal"],
  maxOperations: 5,
  prompt: "",
};

describe("buildWorkerPlanPrompt", () => {
  it("includes safety constraints", () => {
    const prompt = buildWorkerPlanPrompt({ ...baseInput, prompt: "" });
    for (const keyword of PROMPT_SAFETY_KEYWORDS) {
      expect(prompt).toContain(keyword);
    }
  });

  it("includes task and run metadata", () => {
    const prompt = buildWorkerPlanPrompt(baseInput);
    expect(prompt).toContain("run-abc");
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("Maximum operations: 5");
  });
});
