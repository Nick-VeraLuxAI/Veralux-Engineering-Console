import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
} from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "@/lib/engineer-console/repo-intelligence/task-repo-path";
import {
  getDraftValidationErrors,
  getLatestWorkerPlanDraftForRun,
} from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";
import { getWorkerPlanChangedFilesScope } from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { getChangedFiles, getDiffSummary } from "@/lib/engineer-console/workspace/git-workspace";
import type { ApprovalReport } from "@/lib/engineer-console/types";
import { buildRunWorkflowSummary } from "@/lib/engineer-console/run-ux/build-run-workflow-summary";
import { buildRunIntelligenceSummary } from "@/lib/engineer-console/intelligence/build-intelligence-summary";
import { RunLivePanel } from "@/components/engineer-console/run-live-panel";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  ensureEngineerConsoleReady();
  const { id } = await params;
  const run = getRunById(id);
  if (!run) notFound();

  const task = getTaskById(run.taskId);
  if (!task) notFound();

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
  const latestDraft = getLatestWorkerPlanDraftForRun(id);
  const uxSummary = buildRunWorkflowSummary({
    run,
    task,
    qualityGates,
    approvalReport,
    changedFiles,
  });
  const intelligenceSummary = buildRunIntelligenceSummary({
    run,
    task,
    qualityGates,
    approvalReport,
    changedFiles,
    uxSummary,
  });

  return (
    <div>
      <Link
        href={`/engineer/tasks/${task.id}`}
        className="text-sm text-[var(--muted)] hover:text-white"
      >
        ← Task: {task.title}
      </Link>
      <h1 className="mt-4 mb-6 text-2xl font-semibold">Run {run.id.slice(0, 8)}…</h1>
      <RunLivePanel
        runId={id}
        initial={{
          run,
          task,
          changedFiles,
          diffSummary,
          qualityGates,
          approvalReport,
          intelligenceSummary,
          workerPlanDraft: latestDraft
            ? {
                id: latestDraft.id,
                runId: latestDraft.runId,
                provider: latestDraft.provider,
                model: latestDraft.model,
                validationStatus: latestDraft.validationStatus,
                parsedPlan: latestDraft.parsedPlanJson
                  ? JSON.parse(latestDraft.parsedPlanJson)
                  : null,
                rawResponse: latestDraft.rawResponse,
                validationErrors: getDraftValidationErrors(latestDraft),
                createdAt: latestDraft.createdAt,
              }
            : null,
          uxSummary,
        }}
      />
    </div>
  );
}
