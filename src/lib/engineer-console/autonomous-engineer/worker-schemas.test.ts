import { describe, expect, it } from "vitest";
import { validateAutonomousWorkerSchema } from "./worker-schemas";

describe("autonomous worker JSON schemas", () => {
  it("accepts a valid interpretation object", () => {
    const result = validateAutonomousWorkerSchema("interpretation", {
      objectiveSummary: "Add a helper",
      requirements: ["Format QC delta"],
      acceptanceCriteria: ["Unit tests cover empty and regression cases"],
      assumptions: ["No PR"],
      investigationTargets: ["src/lib"],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects interpretation missing required fields", () => {
    const result = validateAutonomousWorkerSchema("interpretation", { summary: "nope" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/objectiveSummary|requirements|acceptanceCriteria/);
  });

  it("accepts a valid worker plan object", () => {
    const result = validateAutonomousWorkerSchema("planning", {
      runId: "run-1",
      summary: "Add helper",
      allowedFiles: ["src/a.ts"],
      operations: [{ type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a plan with shell operations", () => {
    const result = validateAutonomousWorkerSchema("replan", {
      runId: "run-1",
      summary: "bad",
      allowedFiles: ["src/a.ts"],
      operations: [{ type: "shell", path: "src/a.ts", content: "rm -rf", reason: "no" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts diagnosis, completion, and review contracts", () => {
    expect(
      validateAutonomousWorkerSchema("diagnosis", {
        whyPreviousFailed: "QC new failure",
        suggestedStrategy: "Fix the helper return value",
        filesToInspect: ["src/a.ts"],
      }).valid,
    ).toBe(true);
    expect(
      validateAutonomousWorkerSchema("completion", {
        complete: true,
        summary: "AC met",
        unmetAcceptanceCriteria: [],
      }).valid,
    ).toBe(true);
    expect(
      validateAutonomousWorkerSchema("review", {
        passed: true,
        findings: ["scope ok"],
        actionableDefects: [],
      }).valid,
    ).toBe(true);
  });
});
