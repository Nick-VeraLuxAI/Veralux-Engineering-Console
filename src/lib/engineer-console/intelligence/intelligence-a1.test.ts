import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunIntelligenceCard } from "@/components/engineer-console/run-intelligence-card";
import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import type { RunWorkflowSummary } from "@/lib/engineer-console/run-ux/run-ux-types";
import { classifyRunRisk } from "./classify-run-risk";
import type {
  DangerPoint,
  RunIntelligenceSummary,
} from "./danger-point-types";
import { deriveEscalation } from "./derive-escalation";
import type { DetectDangerPointsInput, ParsedWorkerPlanSnapshot } from "./detect-danger-points";
import { detectDangerPoints } from "./detect-danger-points";
import { recommendPlaybooks } from "./recommend-playbooks";

function buildRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "run-1",
    taskId: "task-1",
    status: "waiting_for_approval",
    branchName: "engineer/test-run",
    currentStep: "waiting_for_approval",
    modelRole: "worker",
    retryCount: 0,
    startedAt: "2026-05-26T20:00:00.000Z",
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: null,
    ...overrides,
  };
}

function buildTask(overrides: Partial<EngineeringTask> = {}): EngineeringTask {
  return {
    id: "task-1",
    title: "Update docs",
    description: "Refresh operator docs.",
    targetRepoPath: "/repo",
    registeredRepoId: "repo-1",
    status: "running",
    priority: "normal",
    createdAt: "2026-05-26T20:00:00.000Z",
    updatedAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

function buildQualityGates(
  overrides: Partial<QualityGateResult>[] = [],
): QualityGateResult[] {
  if (overrides.length === 0) {
    return [
      {
        id: "gate-1",
        runId: "run-1",
        command: "npm test",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1000,
        status: "passed",
        createdAt: "2026-05-26T20:00:00.000Z",
      },
    ];
  }
  return overrides.map((override, index) => ({
    id: `gate-${index + 1}`,
    runId: "run-1",
    command: "npm test",
    stdout: "",
    stderr: "",
    exitCode: override.status === "failed" ? 1 : 0,
    durationMs: 1000,
    status: "passed",
    createdAt: "2026-05-26T20:00:00.000Z",
    ...override,
  }));
}

function buildWorkflowSummary(overrides: Partial<RunWorkflowSummary> = {}): RunWorkflowSummary {
  return {
    run: {
      id: "run-1",
      status: "waiting_for_approval",
      currentStep: "waiting_for_approval",
      branchName: "engineer/test-run",
      riskLevel: "low",
      agentMessage: null,
      ...(overrides.run ?? {}),
    },
    task: {
      id: "task-1",
      title: "Update docs",
      description: "Refresh operator docs.",
      ...(overrides.task ?? {}),
    },
    workerPlan: {
      hasDraft: true,
      exists: true,
      validationStatus: "valid",
      executionStatus: "executed",
      validationErrorCount: 0,
      validationWarningCount: 0,
      executionErrorCount: 0,
      executedOperationCount: 1,
      changedFileCount: 1,
      showReadmeSmokeHelper: false,
      ...(overrides.workerPlan ?? {}),
    },
    qualityGates: {
      count: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      failedCommands: [],
      skippedCommands: [],
      ...(overrides.qualityGates ?? {}),
    },
    approval: {
      reportAvailable: true,
      canApprove: true,
      governanceIssues: [],
      recommendedNextAction: "Approve the run.",
      decisionCount: 0,
      latestDecision: null,
      ...(overrides.approval ?? {}),
    },
    evidence: {
      exists: true,
      updatedAt: "2026-05-26T20:00:00.000Z",
      ...(overrides.evidence ?? {}),
    },
    replay: {
      exists: true,
      status: "passed",
      warningCount: 0,
      failedCount: 0,
      ...(overrides.replay ?? {}),
    },
    policy: {
      exists: true,
      status: "passed",
      blockers: [],
      warnings: [],
      reviewRequired: [],
      recommendedNextAction: "Proceed to approval.",
      ...(overrides.policy ?? {}),
    },
    review: {
      stageCount: 0,
      requiredCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      ...(overrides.review ?? {}),
    },
    pr: {
      attemptCount: 0,
      latestStatus: null,
      latestPrUrl: null,
      latestPrNumber: null,
      latestCommitShaPrefix: null,
      latestReadinessStatus: null,
      latestReadinessBlockers: [],
      latestReadinessWarnings: [],
      latestErrorMessage: null,
      ...(overrides.pr ?? {}),
    },
    merge: {
      attemptCount: 0,
      latestStatus: null,
      latestMergeShaPrefix: null,
      ...(overrides.merge ?? {}),
    },
    deployment: {
      approvalCount: 0,
      latestApprovalDecision: null,
      latestExecutionStatus: null,
      latestHealthCheckStatus: null,
      latestHealthPolicyStatus: null,
      latestHealthPolicyRecommendedAction: null,
      latestHealthPolicyBlockers: [],
      latestHealthPolicyWarnings: [],
      ...(overrides.deployment ?? {}),
    },
    release: {
      checklistRecorded: false,
      checklistStatus: null,
      checklistBlockers: [],
      checklistNeedsAttention: [],
      checklistRecommendedAction: null,
      signoffCount: 0,
      latestSignoffDecision: null,
      latestSignoffRationale: null,
      ...(overrides.release ?? {}),
    },
    hardGates: {
      enabled: false,
      mergeStatus: "passed",
      mergeBlockers: [],
      deploymentApprovalStatus: "passed",
      deploymentApprovalBlockers: [],
      deploymentExecutionStatus: "passed",
      deploymentExecutionBlockers: [],
      signoffCompletedStatus: "passed",
      signoffCompletedBlockers: [],
      signoffExceptionsStatus: "passed",
      signoffExceptionsBlockers: [],
      ...(overrides.hardGates ?? {}),
    },
    audit: {
      eventCount: 4,
      chainOk: true,
      chainFailureCount: 0,
      chainFailures: [],
      ...(overrides.audit ?? {}),
    },
  };
}

function buildPlanSnapshot(overrides: Partial<ParsedWorkerPlanSnapshot> = {}): ParsedWorkerPlanSnapshot {
  return {
    summary: "Update docs",
    allowedFiles: ["docs/operator-ux-guide.md"],
    operations: [
      {
        type: "update_file",
        path: "docs/operator-ux-guide.md",
        reason: "Refresh docs",
      },
    ],
    validationStatus: "valid",
    validationErrors: [],
    validationWarnings: [],
    executionStatus: "executed",
    ...overrides,
  };
}

function buildDetectInput(
  overrides: Partial<DetectDangerPointsInput> = {},
): DetectDangerPointsInput {
  const task = overrides.task ?? buildTask();
  const qualityGates = overrides.qualityGates ?? buildQualityGates();
  const approvalReport: ApprovalReport | null =
    overrides.approvalReport ??
    {
      taskSummary: task.title,
      branchName: "engineer/test-run",
      changedFiles: ["docs/operator-ux-guide.md"],
      riskLevel: "low",
      governanceIssues: [],
      qualityGateResults: qualityGates,
      diffSummary: "diff --git a/docs/operator-ux-guide.md b/docs/operator-ux-guide.md",
      recommendedNextAction: "Approve the run.",
      canApprove: true,
      workerPlan: null,
    };

  return {
    run: overrides.run ?? buildRun(),
    task,
    changedFiles: overrides.changedFiles ?? ["docs/operator-ux-guide.md"],
    qualityGates,
    approvalReport,
    uxSummary: overrides.uxSummary ?? buildWorkflowSummary(),
    latestWorkerPlan: overrides.latestWorkerPlan ?? buildPlanSnapshot(),
    latestWorkerPlanDraft: overrides.latestWorkerPlanDraft ?? null,
    latestPolicyResult:
      overrides.latestPolicyResult ??
      {
        runId: "run-1",
        policyId: "policy-1",
        policyName: "Default",
        policyVersion: "1.0.0",
        policyHash: "hash",
        status: "passed",
        summary: "Passed",
        evaluatedAt: "2026-05-26T20:01:00.000Z",
        rules: [],
        blockers: [],
        warnings: [],
        reviewRequired: [],
        signals: {
          runStatus: "waiting_for_approval",
          workerPlanValidationStatus: "valid",
          governanceRiskLevel: "low",
          blockedFileCount: 0,
          changedFileCount: 1,
          qualityGatesFailed: 0,
          qualityGatesSkipped: 0,
          qualityGatesPassed: 1,
          evidenceBundlePresent: true,
          evidenceBundleUpdatedAfterDecision: false,
          decisionRecordCount: 0,
          latestDecision: null,
          replayVerificationStatus: "passed",
          replayVerificationFailedChecks: 0,
          replayVerificationWarningChecks: 0,
          indexedFileMismatchCount: 0,
          unindexedModifiedCount: 0,
          packageLockChanged: false,
          migrationsChanged: false,
          draftValidationIssue: false,
          compatibilityBreakingCount: 0,
          compatibilityWarningCount: 0,
          compatibilityUnknownCount: 0,
        },
        recommendedNextAction: "Proceed to approval.",
      },
    latestReplayResult:
      overrides.latestReplayResult ??
      {
        ok: true,
        runId: "run-1",
        checkedAt: "2026-05-26T20:01:00.000Z",
        status: "passed",
        checks: [],
        summary: {
          passed: 4,
          warnings: 0,
          failed: 0,
        },
      },
    latestPrReadiness: overrides.latestPrReadiness ?? null,
    latestDecisionAt: overrides.latestDecisionAt ?? null,
  };
}

function buildEscalationDanger(severity: DangerPoint["severity"]): DangerPoint {
  return {
    id: `danger-${severity}`,
    category: severity === "critical" ? "protected_domain" : "worker_plan_scope",
    severity,
    title: `${severity} danger`,
    explanation: "Test danger point.",
    evidence: ["example evidence"],
    recommendedAction: "Review",
    anchorTarget: "worker-plan",
    humanReviewRequired: true,
    futurePlaybookPossible: severity !== "critical",
  };
}

function buildCardSummary(overrides: Partial<RunIntelligenceSummary> = {}): RunIntelligenceSummary {
  return {
    dangerPoints: [],
    riskLevel: "low",
    riskScore: 20,
    riskReasons: ["Docs-only change set."],
    highestSeverity: "low",
    changedFileRiskSummary: {
      totalFiles: 1,
      docsOnly: true,
      testOnly: false,
      uiDisplayOnly: false,
      stagingOnly: false,
      reversibleSimpleFileCreation: false,
      domainCounts: { docs: 1 },
      highRiskPaths: [],
      criticalRiskPaths: [],
      summary: "1 docs-only file.",
    },
    confidenceLevel: "high",
    confidenceScore: 86,
    escalationLevel: "none",
    escalationReason: "Low-risk routine change.",
    humanReviewRequired: false,
    recommendedNextAction: "Continue through the existing manual workflow.",
    playbookRecommendations: [],
    operatorSummary: "Risk: Low. Continue through the existing manual workflow.",
    whyThisMatters: "The card explains why the run still looks routine.",
    signalAudit: {
      availableOnRunPage: ["task title and description"],
      derivedLocally: ["risk score"],
    },
    technicalDetails: {
      taskSignals: ["Task: Update docs"],
      verificationSignals: ["Quality gates: 1 passed / 0 failed"],
      releaseSignals: ["PR status: not started"],
      derivedNotes: ["1 docs-only file."],
    },
    ...overrides,
  };
}

describe("A1 run intelligence", () => {
  it("classifies docs-only changes as low risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["docs/intelligence-layer-guide.md"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("low");
    expect(result.changedFileRiskSummary.docsOnly).toBe(true);
  });

  it("classifies test-only changes as low risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/engineer-console/intelligence/intelligence-a1.test.ts"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("low");
    expect(result.changedFileRiskSummary.testOnly).toBe(true);
  });

  it("classifies UI behavior changes as medium risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/components/engineer-console/run-live-panel.tsx"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("medium");
  });

  it("classifies auth or session paths as high risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/auth/session-manager.ts"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("high");
  });

  it("classifies billing or pricing paths as high risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/billing/pricing-rules.ts"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("high");
  });

  it("classifies database migration paths as high risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/engineer-console/db/migrations/20260526_add_table.sql"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("high");
  });

  it("classifies secrets or env paths as critical risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/config/secrets-manager.ts"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("critical");
  });

  it("classifies governance or release gate paths as high risk", () => {
    const result = classifyRunRisk({
      changedFiles: ["src/lib/engineer-console/release/release-gates/evaluate-hard-release-gate.ts"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    expect(result.riskLevel).toBe("high");
  });

  it("blocks escalation when policy is blocked", () => {
    const escalation = deriveEscalation({
      dangerPoints: [],
      riskClassification: classifyRunRisk({
        changedFiles: ["docs/intelligence-layer-guide.md"],
        dangerPoints: [],
        operationTypes: ["update_file"],
        createdFiles: [],
      }),
      qualityGates: { passedCount: 1, failedCount: 0 },
      replay: { status: "passed", warningCount: 0, failedCount: 0 },
      policy: { status: "blocked" },
      review: { pendingCount: 0, rejectedCount: 0, requiredCount: 0 },
      approval: { latestDecision: null },
      pr: { latestStatus: null },
      release: { checklistStatus: null, latestSignoffDecision: null },
      hardGates: {
        mergeStatus: "passed",
        deploymentApprovalStatus: "passed",
        deploymentExecutionStatus: "passed",
        signoffCompletedStatus: "passed",
        signoffExceptionsStatus: "passed",
      },
    });
    expect(escalation.escalationLevel).toBe("blocked");
  });

  it("treats replay warnings as a danger point and operator review", () => {
    const dangerPoints = detectDangerPoints(
      buildDetectInput({
        latestReplayResult: {
          ok: true,
          runId: "run-1",
          checkedAt: "2026-05-26T20:01:00.000Z",
          status: "warning",
          checks: [{ code: "AUDIT_WARNING", status: "warning", message: "Replay warning" }],
          summary: { passed: 3, warnings: 1, failed: 0 },
        },
        uxSummary: buildWorkflowSummary({
          replay: { exists: true, status: "warning", warningCount: 1, failedCount: 0 },
        }),
      }),
    );
    expect(dangerPoints.some((point) => point.id === "replay-warning-or-failure")).toBe(true);

    const escalation = deriveEscalation({
      dangerPoints,
      riskClassification: classifyRunRisk({
        changedFiles: ["docs/intelligence-layer-guide.md"],
        dangerPoints,
        operationTypes: ["update_file"],
        createdFiles: [],
      }),
      qualityGates: { passedCount: 1, failedCount: 0 },
      replay: { status: "warning", warningCount: 1, failedCount: 0 },
      policy: { status: "passed" },
      review: { pendingCount: 0, rejectedCount: 0, requiredCount: 0 },
      approval: { latestDecision: null },
      pr: { latestStatus: null },
      release: { checklistStatus: null, latestSignoffDecision: null },
      hardGates: {
        mergeStatus: "passed",
        deploymentApprovalStatus: "passed",
        deploymentExecutionStatus: "passed",
        signoffCompletedStatus: "passed",
        signoffExceptionsStatus: "passed",
      },
    });
    expect(escalation.escalationLevel).toBe("operator_review");
  });

  it("blocks escalation when a review stage was rejected", () => {
    const escalation = deriveEscalation({
      dangerPoints: [buildEscalationDanger("high")],
      riskClassification: classifyRunRisk({
        changedFiles: ["src/lib/auth/session-manager.ts"],
        dangerPoints: [buildEscalationDanger("high")],
        operationTypes: ["update_file"],
        createdFiles: [],
      }),
      qualityGates: { passedCount: 1, failedCount: 0 },
      replay: { status: "passed", warningCount: 0, failedCount: 0 },
      policy: { status: "passed" },
      review: { pendingCount: 0, rejectedCount: 1, requiredCount: 1 },
      approval: { latestDecision: null },
      pr: { latestStatus: null },
      release: { checklistStatus: null, latestSignoffDecision: null },
      hardGates: {
        mergeStatus: "passed",
        deploymentApprovalStatus: "passed",
        deploymentExecutionStatus: "passed",
        signoffCompletedStatus: "passed",
        signoffExceptionsStatus: "passed",
      },
    });
    expect(escalation.escalationLevel).toBe("blocked");
  });

  it("detects PR partial failure as a PR recovery danger point", () => {
    const dangerPoints = detectDangerPoints(
      buildDetectInput({
        latestPrReadiness: {
          status: "passed",
          blockers: [],
          warnings: [],
          requiredEvidence: [],
          recommendedAction: "Retry draft PR creation.",
          signals: {
            runId: "run-1",
            runStatus: "completed",
            hasApprovedDecision: true,
            hasEvidenceBundle: true,
            policyStatus: "passed",
            replayStatus: "passed",
            reviewStagesApproved: 1,
            reviewStagesPending: 0,
            reviewStagesRejected: 0,
            changedFileCount: 1,
            branchName: "engineer/test-run",
            runBranchName: "engineer/test-run",
            currentBranchName: "engineer/test-run",
            currentBranchMatchesRunBranch: true,
            localRunBranchExists: true,
            localRunBranchSha: "abc",
            remoteBranchExists: true,
            remoteBranchSha: "abc",
            remoteBranchMatchesReusableCommit: true,
            cleanTree: true,
            reusableCommitSha: "abc123",
            reusableCommitShaPrefix: "abc123",
            reusableCommitMessage: "Existing commit",
            reusableCommitSource: "request_history",
            canResume: true,
            resumeReason: "Ready to resume PR creation using the existing run commit.",
            manualRecoveryRequired: false,
            manualRecoveryReason: null,
            existingPrUrl: null,
            existingPrNumber: null,
            governanceRiskLevel: "low",
            qualityGatesFailed: 0,
          },
        },
        uxSummary: buildWorkflowSummary({
          pr: {
            attemptCount: 1,
            latestStatus: "failed",
            latestPrUrl: null,
            latestPrNumber: null,
            latestCommitShaPrefix: "abc123",
            latestReadinessStatus: "passed",
            latestReadinessBlockers: [],
            latestReadinessWarnings: [],
            latestErrorMessage: "gh pr create failed",
          },
        }),
      }),
    );
    expect(dangerPoints.some((point) => point.id === "pr-retry-state")).toBe(true);
  });

  it("tolerates historical PR readiness records without signals", () => {
    const dangerPoints = detectDangerPoints(
      buildDetectInput({
        latestPrReadiness: {
          status: "passed",
          blockers: [],
          warnings: [],
          requiredEvidence: [],
          recommendedAction: "Retry draft PR creation.",
        } as unknown as DetectDangerPointsInput["latestPrReadiness"],
        uxSummary: buildWorkflowSummary({
          pr: {
            attemptCount: 1,
            latestStatus: "failed",
            latestPrUrl: null,
            latestPrNumber: null,
            latestCommitShaPrefix: null,
            latestReadinessStatus: "passed",
            latestReadinessBlockers: [],
            latestReadinessWarnings: [],
            latestErrorMessage: "gh pr create failed",
          },
        }),
      }),
    );
    expect(dangerPoints.some((point) => point.id === "pr-retry-state")).toBe(true);
  });

  it("recommends the branch mismatch playbook", () => {
    const playbooks = recommendPlaybooks({
      dangerPoints: [],
      latestPrReadiness: {
        status: "passed",
        blockers: [],
        warnings: [],
        requiredEvidence: [],
        recommendedAction: "Retry on the run branch.",
        signals: {
          runId: "run-1",
          runStatus: "completed",
          hasApprovedDecision: true,
          hasEvidenceBundle: true,
          policyStatus: "passed",
          replayStatus: "passed",
          reviewStagesApproved: 0,
          reviewStagesPending: 0,
          reviewStagesRejected: 0,
          changedFileCount: 1,
          branchName: "engineer/test-run",
          runBranchName: "engineer/test-run",
          currentBranchName: "feature/local-work",
          currentBranchMatchesRunBranch: false,
          localRunBranchExists: true,
          localRunBranchSha: "abc",
          remoteBranchExists: false,
          remoteBranchSha: null,
          remoteBranchMatchesReusableCommit: false,
          cleanTree: true,
          reusableCommitSha: null,
          reusableCommitShaPrefix: null,
          reusableCommitMessage: null,
          reusableCommitSource: "none",
          canResume: false,
          resumeReason: null,
          manualRecoveryRequired: false,
          manualRecoveryReason: null,
          existingPrUrl: null,
          existingPrNumber: null,
          governanceRiskLevel: "low",
          qualityGatesFailed: 0,
        },
      },
      qualityGateFailed: false,
      replayStatus: "passed",
      policyStatus: "passed",
    });
    expect(playbooks.some((playbook) => playbook.playbookId === "checkout-run-branch")).toBe(true);
  });

  it("recommends re-indexing when a new file is not in the latest index", () => {
    const dangerPoints = detectDangerPoints(
      buildDetectInput({
        latestWorkerPlan: buildPlanSnapshot({
          summary: "Create docs file",
          allowedFiles: ["docs/new-guide.md"],
          operations: [
            {
              type: "create_file",
              path: "docs/new-guide.md",
              reason: "Create guide",
            },
          ],
          validationWarnings: [
            { code: "FILE_NOT_IN_INDEX", message: "docs/new-guide.md was not in the latest file index" },
          ],
        }),
        changedFiles: ["docs/new-guide.md"],
        approvalReport: {
          taskSummary: "Create docs file",
          branchName: "engineer/test-run",
          changedFiles: ["docs/new-guide.md"],
          riskLevel: "low",
          governanceIssues: [],
          qualityGateResults: buildQualityGates(),
          diffSummary: "diff",
          recommendedNextAction: "Approve",
          canApprove: true,
          workerPlan: null,
        },
      }),
    );
    expect(dangerPoints.some((point) => point.id === "file-index-stale")).toBe(true);
    const playbooks = recommendPlaybooks({
      dangerPoints,
      latestPrReadiness: null,
      qualityGateFailed: false,
      replayStatus: "passed",
      policyStatus: "passed",
    });
    expect(playbooks.some((playbook) => playbook.playbookId === "reindex-repository")).toBe(true);
  });

  it("keeps low risk with passing tests at no escalation", () => {
    const risk = classifyRunRisk({
      changedFiles: ["docs/intelligence-layer-guide.md"],
      dangerPoints: [],
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    const escalation = deriveEscalation({
      dangerPoints: [],
      riskClassification: risk,
      qualityGates: { passedCount: 1, failedCount: 0 },
      replay: { status: "passed", warningCount: 0, failedCount: 0 },
      policy: { status: "passed" },
      review: { pendingCount: 0, rejectedCount: 0, requiredCount: 0 },
      approval: { latestDecision: null },
      pr: { latestStatus: null },
      release: { checklistStatus: null, latestSignoffDecision: null },
      hardGates: {
        mergeStatus: "passed",
        deploymentApprovalStatus: "passed",
        deploymentExecutionStatus: "passed",
        signoffCompletedStatus: "passed",
        signoffExceptionsStatus: "passed",
      },
    });
    expect(escalation.escalationLevel).toBe("none");
  });

  it("still requires review when risk is high even if tests passed", () => {
    const dangerPoints = [buildEscalationDanger("high")];
    const risk = classifyRunRisk({
      changedFiles: ["src/lib/auth/session-manager.ts"],
      dangerPoints,
      operationTypes: ["update_file"],
      createdFiles: [],
    });
    const escalation = deriveEscalation({
      dangerPoints,
      riskClassification: risk,
      qualityGates: { passedCount: 2, failedCount: 0 },
      replay: { status: "passed", warningCount: 0, failedCount: 0 },
      policy: { status: "passed" },
      review: { pendingCount: 1, rejectedCount: 0, requiredCount: 1 },
      approval: { latestDecision: null },
      pr: { latestStatus: null },
      release: { checklistStatus: null, latestSignoffDecision: null },
      hardGates: {
        mergeStatus: "passed",
        deploymentApprovalStatus: "passed",
        deploymentExecutionStatus: "passed",
        signoffCompletedStatus: "passed",
        signoffExceptionsStatus: "passed",
      },
    });
    expect(escalation.escalationLevel).toBe("required_review_stage");
  });

  it("renders the run intelligence card", () => {
    const html = renderToStaticMarkup(React.createElement(RunIntelligenceCard, {
      summary: buildCardSummary({
        dangerPoints: [buildEscalationDanger("medium")],
        playbookRecommendations: [
          {
            playbookId: "checkout-run-branch",
            title: "Checkout the run branch before retrying",
            description: "Retry safely on the run branch.",
            safetyLevel: "safe",
            requiresHumanConfirmation: true,
            targetPanelAnchor: "pr-creation",
          },
        ],
      }),
    }));
    expect(html).toContain("Run Intelligence");
    expect(html).toContain("Risk: low");
    expect(html).toContain("Danger points: 1");
    expect(html).toContain("Technical details");
  });

  it("does not fire auto-actions on render", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderToStaticMarkup(React.createElement(RunIntelligenceCard, {
        summary: buildCardSummary(),
      }));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
