import { describe, expect, it } from "vitest";
import { buildApprovalReport, buildFixFollowUpDraft, describeApprovalEligibility, resolveLiveApprovalEligibility } from "./approval-report";
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

  it("explains a failed quality gate before approval", () => {
    const described = describeApprovalEligibility({
      canApprove: false,
      recommendedNextAction: "Request fix: quality gates failed. Review command output and re-run.",
      governanceIssues: [],
      qualityGateResults: [{ command: "npm test", status: "failed" }],
    });
    expect(described.canApprove).toBe(false);
    expect(described.summary).toMatch(/quality gates failed/i);
    expect(described.details[0]).toBe("Quality gate failed: npm");
  });

  it("builds a follow-up fix draft from the block reason", () => {
    const draft = buildFixFollowUpDraft({
      blockedTitle: "Memory Module V0",
      eligibility: {
        summary: "Request fix: quality gates failed. Review command output and re-run.",
        details: ["Quality gate failed: npm"],
      },
    });
    expect(draft.title).toBe("Fix: Memory Module V0");
    expect(draft.objective).toMatch(/cannot be approved/);
    expect(draft.objective).toMatch(/Quality gate failed: npm/);
    expect(draft.success).toMatch(/Quality gates pass/);
    expect(draft.constraints).toMatch(/Do not approve the blocked run/);
  });

  it("allows approval live when stored canApprove is stale but gates only skipped", () => {
    const eligibility = resolveLiveApprovalEligibility({
      runStatus: "waiting_for_approval",
      report: {
        canApprove: false,
        recommendedNextAction: "Approve to mark run ready (no auto-commit or deploy in MVP).",
        governanceIssues: [],
        qualityGateResults: [{ command: "npm test", status: "skipped" }],
        riskLevel: "low",
      },
    });
    expect(eligibility.canApprove).toBe(true);
  });

  it("blocks approval live when a quality gate failed", () => {
    const eligibility = resolveLiveApprovalEligibility({
      runStatus: "waiting_for_approval",
      report: {
        canApprove: true,
        recommendedNextAction: "Approve to mark run ready (no auto-commit or deploy in MVP).",
        governanceIssues: [],
        qualityGateResults: [{ command: "npm test", status: "failed" }],
        riskLevel: "low",
      },
    });
    expect(eligibility.canApprove).toBe(false);
    expect(eligibility.details[0]).toBe("Quality gate failed: npm");
  });
});
