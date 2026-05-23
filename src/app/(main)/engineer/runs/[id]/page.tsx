import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
} from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { getChangedFiles, getDiffSummary } from "@/lib/engineer-console/workspace/git-workspace";
import type { ApprovalReport } from "@/lib/engineer-console/types";
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
    changedFiles = await getChangedFiles(task.targetRepoPath);
    diffSummary = await getDiffSummary(task.targetRepoPath);
  } catch {
    changedFiles = [];
    diffSummary = "";
  }

  const qualityGates = getQualityGateResultsForRun(id);
  const reportJson = getApprovalReportJson(id);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

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
        }}
      />
    </div>
  );
}
