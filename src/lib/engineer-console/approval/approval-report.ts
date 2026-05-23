import type {
  ApprovalReport,
  EngineeringRun,
  EngineeringTask,
  QualityGateResult,
  WorkerPlanReportSummary,
} from "../types";
import type { GovernanceAssessment } from "../governance/governance-engine";

export interface BuildApprovalReportInput {
  task: EngineeringTask;
  run: EngineeringRun;
  changedFiles: string[];
  diffSummary: string;
  governance: GovernanceAssessment;
  qualityGateResults: QualityGateResult[];
  workerPlan?: WorkerPlanReportSummary | null;
}

function gatesPassed(results: QualityGateResult[]): boolean {
  return results.every((r) => r.status === "passed" || r.status === "skipped");
}

function recommendNextAction(
  governance: GovernanceAssessment,
  gatesOk: boolean,
): string {
  if (governance.riskLevel === "blocked") {
    return "Stop and revert protected-path changes before requesting approval.";
  }
  if (!gatesOk) {
    return "Request fix: quality gates failed. Review command output and re-run.";
  }
  if (governance.riskLevel === "high") {
    return "Senior review recommended before approval.";
  }
  if (governance.riskLevel === "medium") {
    return "Review diff scope, then approve or request fix.";
  }
  return "Approve to mark run ready (no auto-commit or deploy in MVP).";
}

export function buildApprovalReport(input: BuildApprovalReportInput): ApprovalReport {
  const gatesOk = gatesPassed(input.qualityGateResults);
  const canApprove =
    input.governance.canApprove && gatesOk && input.run.status === "waiting_for_approval";

  return {
    taskSummary: `${input.task.title}: ${input.task.description || "(no description)"}`,
    branchName: input.run.branchName,
    changedFiles: input.changedFiles,
    riskLevel: input.governance.riskLevel,
    governanceIssues: input.governance.issues,
    qualityGateResults: input.qualityGateResults,
    diffSummary: input.diffSummary,
    recommendedNextAction: recommendNextAction(input.governance, gatesOk),
    canApprove,
    workerPlan: input.workerPlan ?? null,
  };
}
