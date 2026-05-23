import { describe, expect, it } from "vitest";
import { buildApprovalReport } from "./approval-report";
import type { EngineeringRun, EngineeringTask, QualityGateResult } from "../types";

const baseTask: EngineeringTask = {
  id: "task-1",
  title: "Fix lint",
  description: "Clean up warnings",
  targetRepoPath: "/tmp/repo",
  status: "waiting_for_approval",
  priority: "normal",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseRun: EngineeringRun = {
  id: "run-1",
  taskId: "task-1",
  status: "waiting_for_approval",
  branchName: "engineer/task/run",
  currentStep: "waiting_for_approval",
  modelRole: "engineer",
  retryCount: 0,
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  agentMessage: "placeholder",
  riskLevel: "low",
  governanceNotes: null,
};

const passedGate: QualityGateResult = {
  id: "g1",
  runId: "run-1",
  command: "npm test",
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  durationMs: 100,
  status: "passed",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("buildApprovalReport", () => {
  it("allows approval when gates pass and risk is low", () => {
    const report = buildApprovalReport({
      task: baseTask,
      run: baseRun,
      changedFiles: ["src/a.ts"],
      diffSummary: "1 file changed",
      governance: {
        riskLevel: "low",
        issues: [],
        blockedFiles: [],
        canApprove: true,
      },
      qualityGateResults: [passedGate],
    });
    expect(report.canApprove).toBe(true);
    expect(report.riskLevel).toBe("low");
  });

  it("blocks approval when governance is blocked", () => {
    const report = buildApprovalReport({
      task: baseTask,
      run: baseRun,
      changedFiles: [".env"],
      diffSummary: "",
      governance: {
        riskLevel: "blocked",
        issues: ["Blocked"],
        blockedFiles: [".env"],
        canApprove: false,
      },
      qualityGateResults: [passedGate],
    });
    expect(report.canApprove).toBe(false);
  });
});
