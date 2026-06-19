import { runAgentWorker } from "../agent-worker/agent-worker";
import { isVeraStartedImplementationRun } from "../bridge/vera-handoff-task-types";
import { runVeraImplementationPipeline } from "./vera-implementation-run-pipeline";
import { getWorkspaceForAttempt } from "../project-orchestration/execution-workspace-manager";
import { getExecutionAttemptByRunId } from "../project-orchestration/requirement-execution-manager";
import { mergeRunGovernanceNotes, runVeraExecutorForRun } from "../vera-executor/vera-executor";
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
import { buildApprovalReport } from "../approval/approval-report";
import {
  refreshRunEvidenceBundle,
  requireRunEvidenceBundle,
} from "../governance/evidence-bundles/evidence-bundle-manager";
import {
  assertPolicyAllowsApproval,
  runPolicyEvaluation,
} from "../governance/policy-results/policy-result-manager";
import {
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
  auditRunStarted(runId, task.id, { path: "default_run" });

  try {
    const repoPath = resolveTaskTargetRepoPath(task);

    await verifyGitRepo(repoPath);

    const governedAttempt = getExecutionAttemptByRunId(runId);
    const implementationWorkspace = governedAttempt
      ? getWorkspaceForAttempt(governedAttempt.id, "implementation")
      : null;
    const executionRepoPath = implementationWorkspace?.worktreePath ?? repoPath;
    const branchName = implementationWorkspace?.branchName ?? generateBranchName(task.id, runId);
    await setRunStep(runId, "creating_branch", "creating_branch", { branchName });

    if (!implementationWorkspace) {
      try {
        await createBranch(repoPath, branchName);
        auditBranchCreated(runId, task.id, branchName);
      } catch {
        // Branch may already exist from a partial retry — continue if checkout works
      }
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

    await setRunStep(runId, "generating_patch", implementationWorkspace ? "vera_run_submitting" : "generating_patch");
    const agentResult = implementationWorkspace
      ? await runVeraExecutorForRun(runId).then(async (result) => {
          if (result.status === "completed") {
            return {
              message: result.summary,
              simulatedPatchApplied: false,
            };
          }

          const reconciledChangedFiles = await getChangedFiles(executionRepoPath).catch(() => []);
          if (reconciledChangedFiles.length === 0) {
            throw new Error(result.failure?.message ?? result.summary);
          }

          updateRun(runId, {
            status: "execution_indeterminate",
            currentStep: "reconciliation_required",
            agentMessage: result.failure?.message ?? result.summary,
            governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
              veraReconciliation: {
                status: "reconciliation_required",
                trigger: result.failure?.code ?? result.status,
                externalRunId: result.externalRunId,
                lastEvent: result.events[result.events.length - 1]?.event ?? null,
                toolActivityObserved: result.events.some((event) => event.event.startsWith("tool.")),
                worktreeId: implementationWorkspace.id,
                worktreePath: implementationWorkspace.worktreePath,
                changedFiles: reconciledChangedFiles,
                attemptCount: 1,
              },
            }),
          });

          return {
            message: `Vera run ended indeterminately (${result.failure?.code ?? result.status}); Console reconciled assigned worktree changes.`,
            simulatedPatchApplied: false,
          };
        })
      : process.env.ENGINEER_CONSOLE_EXECUTION_BACKEND === "mock" || process.env.NODE_ENV === "test"
        ? await runAgentWorker({
            taskTitle: task.title,
            taskDescription: task.description,
            repoPath,
            branchName,
          })
        : (() => {
            throw new Error("Live Vera execution requires a governed implementation workspace.");
          })();

    await setRunStep(runId, "applying_patch", "applying_patch", {
      agentMessage: agentResult.message,
    });

    const changedFiles = await getChangedFiles(executionRepoPath);
    const diffSummary = await getDiffSummary(executionRepoPath);
    if (implementationWorkspace !== null && changedFiles.length === 0) {
      const message = [
        "NO_CHANGE_IMPLEMENTATION_INCOMPLETE: Vera completed without producing required source changes.",
        "No Git changes were detected in the governed implementation worktree.",
        "Retry feedback: inspect the specified source file, make the bounded change, run the deterministic test, and do not return another plan-only response.",
      ].join(" ");
      updateRun(runId, {
        status: "failed",
        currentStep: "no_change_implementation_incomplete",
        agentMessage: message,
        governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
          veraCompletionContract: {
            status: "NO_CHANGE_IMPLEMENTATION_INCOMPLETE",
            expectedChange: true,
            changedFiles,
            feedback: message,
          },
        }),
        completedAt: nowIso(),
      });
      updateTask(task.id, { status: "failed" });
      auditRunFailed(runId, task.id, {
        via: "vera_completion_contract",
        status: "NO_CHANGE_IMPLEMENTATION_INCOMPLETE",
      });
      return;
    }
    const governance = assessChangedFiles(changedFiles);
    const reconciliationWasUsed =
      implementationWorkspace !== null && agentResult.message.includes("Console reconciled assigned worktree changes");

    await setRunStep(runId, "running_quality_gates", "running_quality_gates", {
      riskLevel: governance.riskLevel,
      governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
        governance,
        veraReconciliationResult: reconciliationWasUsed
          ? {
              status: "quality_gates_started",
              changedFiles,
            }
          : undefined,
      }),
    });

    auditQualityGatesStarted(runId, task.id);
    const gateResults = await runQualityGates({
      repoPath: executionRepoPath,
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
      governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
        governance,
        veraReconciliationResult: reconciliationWasUsed
          ? {
              status: finalRunStatus === "waiting_for_approval" ? "validated" : "rejected",
              changedFiles,
              qualityGateFailures: gateResults.filter((g) => g.status === "failed").length,
              riskLevel: governance.riskLevel,
            }
          : undefined,
      }),
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
): Promise<{ runId: string; taskId: string; status: string; decisionRecordId: string } | null> {
  const run = getRunById(runId);
  if (!run) return null;

  const task = getTaskById(run.taskId);
  if (!task) return null;

  const actorType = options.actorType ?? AUDIT_ACTOR_TYPES.HUMAN;
  const rationale = options.rationale?.trim() ?? "";

  if ((action === "request_fix" || action === "stop") && !rationale) {
    throw new Error("Rationale is required for request fix and stop.");
  }

  const completedAt = nowIso();

  if (action === "approve") {
    const reportJson = getApprovalReportJson(runId);
    if (reportJson) {
      const report = JSON.parse(reportJson) as { canApprove?: boolean };
      if (!report.canApprove) {
        throw new Error("Approval blocked by governance or quality gates.");
      }
    }
    assertPolicyAllowsApproval(runId, rationale, { reevaluate: true });
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
    case "request_fix":
      updateRun(runId, {
        status: "failed",
        currentStep: "fix_requested",
        completedAt,
      });
      updateTask(task.id, { status: "failed" });
      auditHumanRequestFix(runId, task.id, humanActorLabel);
      auditRunFailed(runId, task.id, { via: "human_request_fix" });
      break;
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
