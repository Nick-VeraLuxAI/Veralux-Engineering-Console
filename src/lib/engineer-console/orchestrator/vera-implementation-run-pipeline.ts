import { buildApprovalReport } from "../approval/approval-report";
import {
  auditVeraImplementationArtifactCreated,
  auditVeraImplementationWorkerBlocked,
  auditVeraImplementationWorkerFailed,
  auditVeraImplementationWorkerStarted,
} from "../bridge/vera-handoff-audit-lifecycle";
import {
  isVeraStartedImplementationRun,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "../bridge/vera-handoff-task-types";
import {
  auditPostChangePipeline,
  auditQualityGatesStarted,
} from "../governance/audit-ledger/audit-lifecycle";
import type { GovernanceAssessment } from "../governance/governance-engine";
import { assessChangedFiles } from "../governance/governance-engine";
import { refreshRunEvidenceBundle } from "../governance/evidence-bundles/evidence-bundle-manager";
import { runPolicyEvaluation } from "../governance/policy-results/policy-result-manager";
import { reconcileReviewStagesAfterPolicy } from "../governance/review-stages/review-stage-integration";
import type { QualityGateCommandResult } from "../quality-gates/quality-gate-runner";
import {
  getQualityGateResultsForRun,
  getRunById,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../run-manager/run-manager";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { EngineeringTask } from "../types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
} from "../worker/vera-implementation-artifact-types";
import { runVeraImplementationWorker } from "../worker/vera-implementation-worker";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";

function nowIso(): string {
  return new Date().toISOString();
}

function buildSkippedQualityGatesForVeraArtifact(): QualityGateCommandResult[] {
  return [
    {
      command: "(vera-artifact)",
      stdout: "",
      stderr:
        "Source quality gates skipped: Vera implementation worker produced an external artifact only; no repository source changes were made.",
      exitCode: 0,
      durationMs: 0,
      status: "skipped",
    },
  ];
}

function buildGovernanceForWorkerResult(
  changedFiles: string[],
  blockers: string[],
): GovernanceAssessment {
  if (blockers.length > 0) {
    return {
      riskLevel: "medium",
      issues: blockers,
      blockedFiles: [],
      canApprove: false,
    };
  }
  return assessChangedFiles(changedFiles);
}

export async function runVeraImplementationPipeline(input: {
  runId: string;
  task: EngineeringTask;
  repoPath: string;
  branchName: string;
}): Promise<void> {
  const run = getRunById(input.runId);
  if (!run || !isVeraStartedImplementationRun(run)) {
    throw new Error("Run is not a Vera-started implementation run.");
  }

  const task = getTaskById(input.task.id) ?? input.task;
  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  updateRun(input.runId, {
    status: "generating_patch",
    currentStep: "vera_implementation_worker",
  });

  auditVeraImplementationWorkerStarted(task.id, input.runId, {
    veraWorkOrderId,
    branchName: input.branchName,
    repoPath: input.repoPath,
  });

  const workerResult = runVeraImplementationWorker({
    runId: input.runId,
    task,
    repoPath: input.repoPath,
    branchName: input.branchName,
    governanceNotes: run.governanceNotes,
    veraWorkOrderId,
  });

  if (workerResult.status === "failed" || !workerResult.artifact) {
    const message = workerResult.message || "Vera implementation worker failed.";
    auditVeraImplementationWorkerFailed(task.id, input.runId, {
      veraWorkOrderId,
      branchName: input.branchName,
      message,
      workerMode: workerResult.workerMode,
    });
    updateRun(input.runId, {
      status: "failed",
      currentStep: "failed",
      agentMessage: message,
      completedAt: nowIso(),
    });
    updateTask(task.id, { status: "failed" });
    throw new Error(message);
  }

  const artifactStep =
    workerResult.status === "blocked"
      ? VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP
      : VERA_IMPLEMENTATION_ARTIFACT_READY_STEP;

  if (workerResult.status === "blocked") {
    auditVeraImplementationWorkerBlocked(task.id, input.runId, {
      veraWorkOrderId,
      branchName: input.branchName,
      artifactPath: workerResult.artifactPath,
      artifactHash: workerResult.artifactHash,
      workerMode: workerResult.workerMode,
      blockers: workerResult.artifact.blockers,
    });
  } else {
    auditVeraImplementationArtifactCreated(task.id, input.runId, {
      veraWorkOrderId,
      branchName: input.branchName,
      artifactPath: workerResult.artifactPath,
      artifactHash: workerResult.artifactHash,
      workerMode: workerResult.workerMode,
    });
  }

  updateRun(input.runId, {
    status: "running_quality_gates",
    currentStep: "running_quality_gates",
    branchName: input.branchName,
    agentMessage: workerResult.message,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationArtifactPath: workerResult.artifactPath,
      veraImplementationArtifactHash: workerResult.artifactHash,
      veraImplementationWorkerStatus: workerResult.status,
      veraImplementationWorkerMode: workerResult.workerMode,
    }),
  });

  const changedFiles = await getChangedFiles(input.repoPath);
  const diffSummary = await getDiffSummary(input.repoPath, { changedFiles });
  const governance = buildGovernanceForWorkerResult(
    changedFiles,
    workerResult.artifact.blockers,
  );

  auditQualityGatesStarted(input.runId, task.id);
  const gateResults = buildSkippedQualityGatesForVeraArtifact();
  saveQualityGateResults(input.runId, gateResults);

  const finalRunStatus = "waiting_for_approval";
  updateRun(input.runId, {
    status: finalRunStatus,
    currentStep: artifactStep,
    branchName: input.branchName,
    agentMessage: workerResult.message,
    riskLevel: governance.riskLevel,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationArtifactPath: workerResult.artifactPath,
      veraImplementationArtifactHash: workerResult.artifactHash,
      veraImplementationWorkerStatus: workerResult.status,
      veraImplementationWorkerMode: workerResult.workerMode,
      riskLevel: governance.riskLevel,
      issues: governance.issues,
      blockedFiles: governance.blockedFiles,
      canApprove: governance.canApprove,
    }),
    completedAt: null,
  });

  const updatedRun = getRunById(input.runId)!;
  const storedGates = getQualityGateResultsForRun(input.runId);
  const report = buildApprovalReport({
    task,
    run: updatedRun,
    changedFiles,
    diffSummary,
    governance,
    qualityGateResults: storedGates,
  });
  saveApprovalReport(input.runId, JSON.stringify(report));

  auditPostChangePipeline(input.runId, task.id, {
    governance: {
      riskLevel: governance.riskLevel,
      canApprove: governance.canApprove,
      issueCount: governance.issues.length,
    },
    gateSummary: {
      total: gateResults.length,
      failed: 0,
      passed: 0,
      skipped: gateResults.length,
    },
    finalRunStatus,
    changedFileCount: changedFiles.length,
    canApprove: report.canApprove,
  });

  runPolicyEvaluation(input.runId, { persist: true, audit: true });
  await reconcileReviewStagesAfterPolicy(input.runId, {
    changedFiles,
    diffSummary,
  });
  await refreshRunEvidenceBundle({ runId: input.runId });

  updateTask(task.id, { status: "waiting_for_approval" });
}
