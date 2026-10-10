import { runAgentWorker } from "../agent-worker/agent-worker";
import { isVeraStartedImplementationRun } from "../bridge/vera-handoff-task-types";
import { runVeraImplementationPipeline } from "./vera-implementation-run-pipeline";
import { getAutonomousState, isAutonomousRun } from "../autonomous-engineer/state-store";
import { executeAutonomousLoop } from "../autonomous-engineer/loop";
import { continueEngineeringAndResume } from "../autonomous-engineer/continue-engineering";
import { getGovernanceModeConfig } from "../governance/governance-mode";
import {
  auditBranchCreated,
  auditHumanApproved,
  auditHumanRequestFix,
  auditHumanStopped,
  auditPostChangePipeline,
  auditQualityGatesStarted,
  auditRunCompleted,
  auditRunFailed,
  auditRunStarted,
} from "../governance/audit-ledger/audit-lifecycle";
import { assessChangedFiles } from "../governance/governance-engine";
import { runQualityGates } from "../quality-gates/quality-gate-runner";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../run-manager/run-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import { buildApprovalReport, resolveLiveApprovalEligibility } from "../approval/approval-report";
import {
  refreshRunEvidenceBundle,
  requireRunEvidenceBundle,
} from "../governance/evidence-bundles/evidence-bundle-manager";
import {
  assertPolicyAllowsApproval,
  runPolicyEvaluation,
} from "../governance/policy-results/policy-result-manager";
import {
  acknowledgePendingRequiredReviewStages,
  assertReviewStagesAllowApproval,
} from "../governance/review-stages/review-stage-manager";
import { reconcileReviewStagesAfterPolicy } from "../governance/review-stages/review-stage-integration";
import {
  recordDecisionForApprovalAction,
  DecisionRecordError,
} from "../governance/decision-records/decision-record-manager";
import {
  AUDIT_ACTOR_TYPES,
  type AuditActorType,
} from "../governance/audit-ledger/audit-event-types";
import {
  createBranch,
  generateBranchName,
  getChangedFiles,
  getDiffSummary,
  verifyGitRepo,
} from "../workspace/git-workspace";

function nowIso(): string {
  return new Date().toISOString();
}

async function setRunStep(
  runId: string,
  status: Parameters<typeof updateRun>[1]["status"],
  currentStep: string,
  extra: Partial<Parameters<typeof updateRun>[1]> = {},
) {
  updateRun(runId, { status, currentStep, ...extra });
}

export async function executeRun(runId: string): Promise<void> {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found: ${run.taskId}`);
  }

  updateTask(task.id, { status: "running" });
  updateRun(runId, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: run.startedAt ?? nowIso(),
  });
  auditRunStarted(runId, task.id, {
    path: isAutonomousRun(runId) ? "autonomous_engineer" : "default_run",
  });

  try {
    if (isAutonomousRun(runId)) {
      await executeAutonomousLoop(runId);
      return;
    }

    const repoPath = resolveTaskTargetRepoPath(task);

    await verifyGitRepo(repoPath);

    const branchName = generateBranchName(task.id, runId);
    await setRunStep(runId, "creating_branch", "creating_branch", { branchName });

    try {
      await createBranch(repoPath, branchName);
      auditBranchCreated(runId, task.id, branchName);
    } catch {
      // Branch may already exist from a partial retry — continue if checkout works
    }

    const currentRun = getRunById(runId);
    if (currentRun && isVeraStartedImplementationRun(currentRun)) {
      await runVeraImplementationPipeline({
        runId,
        task,
        repoPath,
        branchName,
      });
      return;
    }

    await setRunStep(runId, "generating_patch", "generating_patch");
    const agentResult = await runAgentWorker({
      taskTitle: task.title,
      taskDescription: task.description,
      repoPath,
      branchName,
    });

    await setRunStep(runId, "applying_patch", "applying_patch", {
      agentMessage: agentResult.message,
    });

    const changedFiles = await getChangedFiles(repoPath);
    const diffSummary = await getDiffSummary(repoPath);
    const governance = assessChangedFiles(changedFiles);

    await setRunStep(runId, "running_quality_gates", "running_quality_gates", {
      riskLevel: governance.riskLevel,
      governanceNotes: JSON.stringify(governance),
    });

    auditQualityGatesStarted(runId, task.id);
    const gateResults = await runQualityGates({
      repoPath,
      registeredRepoId: task.registeredRepoId,
    });
    saveQualityGateResults(runId, gateResults);

    const gatesFailed = gateResults.some((g) => g.status === "failed");
    const finalRunStatus = gatesFailed || governance.riskLevel === "blocked"
      ? "failed"
      : "waiting_for_approval";

    const completedAt = finalRunStatus === "failed" ? nowIso() : null;
    updateRun(runId, {
      status: finalRunStatus,
      currentStep: finalRunStatus,
      branchName,
      agentMessage: agentResult.message,
      riskLevel: governance.riskLevel,
      governanceNotes: JSON.stringify(governance),
      completedAt,
    });

    const updatedRun = getRunById(runId)!;
    const storedGates = getQualityGateResultsForRun(runId);
    const report = buildApprovalReport({
      task,
      run: updatedRun,
      changedFiles,
      diffSummary,
      governance,
      qualityGateResults: storedGates,
    });
    saveApprovalReport(runId, JSON.stringify(report));

    auditPostChangePipeline(runId, task.id, {
      governance: {
        riskLevel: governance.riskLevel,
        canApprove: governance.canApprove,
        issueCount: governance.issues.length,
      },
      gateSummary: {
        total: gateResults.length,
        failed: gateResults.filter((g) => g.status === "failed").length,
        passed: gateResults.filter((g) => g.status === "passed").length,
        skipped: gateResults.filter((g) => g.status === "skipped").length,
      },
      finalRunStatus,
      changedFileCount: changedFiles.length,
      canApprove: report.canApprove,
    });

    runPolicyEvaluation(runId, { persist: true, audit: true });

    await reconcileReviewStagesAfterPolicy(runId, {
      changedFiles,
      diffSummary,
    });

    if (finalRunStatus === "waiting_for_approval") {
      updateTask(task.id, { status: "waiting_for_approval" });
    } else {
      updateTask(task.id, { status: "failed" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRun(runId, {
      status: "failed",
      currentStep: "failed",
      agentMessage: message,
      completedAt: nowIso(),
    });
    updateTask(task.id, { status: "failed" });
    auditRunFailed(runId, task.id, { message, path: "default_run" });
    throw error;
  }
}

export interface HandleApprovalActionOptions {
  actorType?: AuditActorType;
  actorLabel?: string;
  rationale?: string;
}

export async function handleApprovalAction(
  runId: string,
  action: "approve" | "request_fix" | "stop",
  options: HandleApprovalActionOptions = {},
): Promise<{
  runId: string;
  taskId: string;
  status: string;
  decisionRecordId: string;
  resumedAe?: boolean;
} | null> {
  const run = getRunById(runId);
  if (!run) return null;

  const task = getTaskById(run.taskId);
  if (!task) return null;

  const actorType = options.actorType ?? AUDIT_ACTOR_TYPES.HUMAN;
  const rationale = options.rationale?.trim() ?? "";
  const governance = getGovernanceModeConfig();

  if ((action === "request_fix" || action === "stop") && !rationale) {
    throw new Error("Rationale is required for request fix and stop.");
  }

  const completedAt = nowIso();

  if (action === "approve") {
    acknowledgePendingRequiredReviewStages({
      runId,
      actorType,
      actorLabel: options.actorLabel ?? "operator",
      rationale,
    });
    const reportJson = getApprovalReportJson(runId);
    const report = reportJson
      ? (JSON.parse(reportJson) as {
          canApprove?: boolean;
          recommendedNextAction?: string;
          governanceIssues?: string[];
          qualityGateResults?: Array<{ command?: string; status?: string }>;
          riskLevel?: string;
        })
      : null;
    const eligibility = resolveLiveApprovalEligibility({
      runStatus: getRunById(runId)?.status ?? run.status,
      report: report
        ? {
            canApprove: Boolean(report.canApprove),
            recommendedNextAction: report.recommendedNextAction,
            governanceIssues: report.governanceIssues,
            qualityGateResults: report.qualityGateResults,
            riskLevel: report.riskLevel,
          }
        : null,
    });
    if (!eligibility.canApprove) {
      const extra = eligibility.details[0] ? ` ${eligibility.details[0]}` : "";
      throw new Error(`${eligibility.summary}${extra}`);
    }
    assertPolicyAllowsApproval(runId, rationale, {
      reevaluate: true,
      observationalReview: governance.policyReviewIsObservational,
    });
    await requireRunEvidenceBundle(runId);
    assertReviewStagesAllowApproval(runId);
  }

  await refreshRunEvidenceBundle({ runId });

  let decisionRecord;
  try {
    decisionRecord = recordDecisionForApprovalAction({
      runId,
      action,
      actorType,
      actorLabel: options.actorLabel ?? "operator",
      rationale: rationale || null,
    });
  } catch (error) {
    if (error instanceof DecisionRecordError) {
      throw error;
    }
    throw new DecisionRecordError(
      error instanceof Error ? error.message : "Decision record creation failed.",
    );
  }

  const humanActorLabel = options.actorLabel ?? "operator";

  switch (action) {
    case "approve": {
      updateRun(runId, {
        status: "completed",
        currentStep: "approved_by_operator",
        completedAt,
      });
      updateTask(task.id, { status: "approved" });
      auditHumanApproved(runId, task.id, humanActorLabel);
      auditRunCompleted(runId, task.id, { via: "human_approve" });
      break;
    }
    case "request_fix": {
      const shouldResumeAe =
        governance.continueEngineeringResumesAe &&
        isAutonomousRun(runId) &&
        (run.status === "waiting_for_approval" ||
          getAutonomousState(runId)?.currentState === "waiting_for_approval");

      if (shouldResumeAe) {
        auditHumanRequestFix(runId, task.id, humanActorLabel);
        // Fire-and-forget: same pattern as POST /tasks/:id/runs for AE.
        void continueEngineeringAndResume({
          runId,
          feedback: rationale,
          actorLabel: humanActorLabel,
        }).catch((error) => {
          console.error(`Continue engineering failed for run ${runId}:`, error);
        });
        await refreshRunEvidenceBundle({ runId });
        return {
          runId,
          taskId: task.id,
          status: "continue_engineering",
          decisionRecordId: decisionRecord.id,
          resumedAe: true,
        };
      }

      updateRun(runId, {
        status: "failed",
        currentStep: "fix_requested",
        completedAt,
      });
      updateTask(task.id, { status: "failed" });
      auditHumanRequestFix(runId, task.id, humanActorLabel);
      auditRunFailed(runId, task.id, { via: "human_request_fix" });
      break;
    }
    case "stop":
      updateRun(runId, {
        status: "failed",
        currentStep: "stopped_by_operator",
        completedAt,
      });
      updateTask(task.id, { status: "stopped" });
      auditHumanStopped(runId, task.id, humanActorLabel);
      auditRunFailed(runId, task.id, { via: "human_stop" });
      break;
  }

  await refreshRunEvidenceBundle({ runId });

  return {
    runId,
    taskId: task.id,
    status: action,
    decisionRecordId: decisionRecord.id,
  };
}
