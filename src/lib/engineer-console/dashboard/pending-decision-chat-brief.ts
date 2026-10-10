import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { listReviewStagesForRun } from "../governance/review-stages/review-stage-manager";
import { buildRunDecisionBrief, formatPendingDecisionForChat } from "../run-ux/run-decision-brief";
import type { ApprovalReport } from "../types";

export function loadPendingDecisionChatContext(runId: string): string | null {
  const run = getRunById(runId);
  const recovering = run?.status === "failed" && run.currentStep === "fix_requested";
  if (!run || (run.status !== "waiting_for_approval" && !recovering)) return null;
  const task = getTaskById(run.taskId);
  const reportJson = getApprovalReportJson(runId);
  const report = reportJson ? (JSON.parse(reportJson) as ApprovalReport) : null;
  const stages = listReviewStagesForRun(runId).filter((stage) => stage.required && stage.status === "pending");
  const workerNote = run.agentMessage?.trim().slice(0, 800);
  const brief = buildRunDecisionBrief({
    taskTitle: task?.title ?? "This job",
    happening: recovering
      ? `The operator sent this job back. Step: ${run.currentStep}. ${task?.description?.trim() || ""}`.trim()
      : [
          "The worker finished a change. Automatic tests did not fully run, or policy asked a person to look, so this job is waiting on you.",
          task?.description?.trim() ?? "",
          workerNote ? `Worker note: ${workerNote}` : "",
        ]
          .filter(Boolean)
          .join(" "),
    recommendation: report?.recommendedNextAction ?? "Read the evidence, ask questions, then approve or send it back.",
    canApprove: Boolean(report?.canApprove),
    changedFiles: report?.changedFiles ?? [],
    qualityGates: report?.qualityGateResults ?? getQualityGateResultsForRun(runId),
    governanceIssues: report?.governanceIssues ?? [],
    pendingChecks: stages.map((stage) => ({
      id: stage.id,
      stage: stage.stage,
      reason: stage.reason,
      status: stage.status,
    })),
    pendingReviewCount: stages.length,
  });
  return formatPendingDecisionForChat(brief);
}
