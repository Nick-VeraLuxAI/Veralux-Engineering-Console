import { NextResponse } from "next/server";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
} from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "@/lib/engineer-console/repo-intelligence/task-repo-path";
import { getWorkerPlanChangedFilesScope } from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { getChangedFiles, getDiffSummary } from "@/lib/engineer-console/workspace/git-workspace";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import type { ApprovalReport } from "@/lib/engineer-console/types";
import {
  getLatestWorkerPlanForRun,
  listWorkerOperations,
  parseValidationErrors,
} from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import {
  getDraftValidationErrors,
  getLatestWorkerPlanDraftForRun,
} from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const run = getRunById(id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let changedFiles: string[] = [];
  let diffSummary = "";
  try {
    const repoPath = resolveTaskTargetRepoPath(task);
    const scope = getWorkerPlanChangedFilesScope(id);
    changedFiles = await getChangedFiles(repoPath, scope ?? {});
    diffSummary = await getDiffSummary(repoPath, { changedFiles });
  } catch {
    changedFiles = [];
    diffSummary = "";
  }

  const qualityGates = getQualityGateResultsForRun(id);
  const reportJson = getApprovalReportJson(id);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const latestWorkerPlan = getLatestWorkerPlanForRun(id);
  const workerPlanOperations = latestWorkerPlan
    ? listWorkerOperations(latestWorkerPlan.id)
    : [];

  const latestDraft = getLatestWorkerPlanDraftForRun(id);

  return NextResponse.json({
    run,
    task,
    changedFiles,
    diffSummary,
    qualityGates,
    approvalReport,
    workerPlan: latestWorkerPlan
      ? {
          ...latestWorkerPlan,
          validationErrors: parseValidationErrors(latestWorkerPlan.validationErrorsJson),
          validationWarnings: parseValidationErrors(latestWorkerPlan.validationWarningsJson),
          executionErrors: parseValidationErrors(latestWorkerPlan.executionErrorsJson),
          operations: workerPlanOperations,
        }
      : null,
    workerPlanDraft: latestDraft
      ? {
          id: latestDraft.id,
          provider: latestDraft.provider,
          model: latestDraft.model,
          validationStatus: latestDraft.validationStatus,
          parsedPlan: latestDraft.parsedPlanJson
            ? JSON.parse(latestDraft.parsedPlanJson)
            : null,
          validationErrors: getDraftValidationErrors(latestDraft),
          createdAt: latestDraft.createdAt,
        }
      : null,
  });
}
