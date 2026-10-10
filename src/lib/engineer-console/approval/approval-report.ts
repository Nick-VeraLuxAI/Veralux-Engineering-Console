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

export function describeApprovalEligibility(report: {
  canApprove: boolean;
  recommendedNextAction?: string;
  governanceIssues?: string[];
  qualityGateResults?: Array<{ command?: string; status?: string }>;
  riskLevel?: string;
  runStatus?: string;
} | null): {
  canApprove: boolean;
  summary: string;
  details: string[];
} {
  if (!report) {
    return {
      canApprove: false,
      summary: "Approval is not ready yet. Open the run to see gates and governance.",
      details: [],
    };
  }
  const failedGates = (report.qualityGateResults ?? [])
    .filter((gate) => gate.status === "failed")
    .map((gate) => publicGateCommand(gate.command));
  const issues = (report.governanceIssues ?? []).map(publicIssueLine).filter(Boolean);
  const details = [
    ...failedGates.map((command) => `Quality gate failed: ${command}`),
    ...issues.map((issue) => `Governance: ${issue}`),
  ].slice(0, 6);
  if (report.runStatus && report.runStatus !== "waiting_for_approval") {
    details.unshift(`Run status is ${report.runStatus.replace(/_/g, " ")}.`);
  }
  if (report.riskLevel === "blocked") {
    details.unshift("Governance blocked this change set.");
  }
  if (report.canApprove) {
    return {
      canApprove: true,
      summary: report.recommendedNextAction?.trim() || "This run is eligible to approve.",
      details: [],
    };
  }
  return {
    canApprove: false,
    summary:
      report.recommendedNextAction?.trim() ||
      "Approval is blocked by a failed quality gate or a governance rule.",
    details,
  };
}

export function buildFixFollowUpDraft(input: {
  blockedTitle: string;
  eligibility: {
    summary: string;
    details: string[];
  };
}): {
  title: string;
  objective: string;
  success: string;
  constraints: string;
} {
  const base = input.blockedTitle.trim() || "blocked run";
  const title = `Fix: ${base}`.slice(0, 80);
  const reasons = [input.eligibility.summary, ...input.eligibility.details]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const objective = [
    `The previous run for ${base} cannot be approved.`,
    ...reasons,
    "Clear those blockers in the working repo. Do not bypass gates or governance.",
  ].join("\n");
  return {
    title,
    objective: objective.slice(0, 800),
    success: "Quality gates pass. Governance no longer blocks approval.",
    constraints: "Do not approve the blocked run. Do not skip gates. Keep the change scoped to the failure.",
  };
}

function publicGateCommand(command: string | undefined): string {
  const trimmed = (command ?? "quality gate").trim().split(/\s+/)[0] ?? "quality gate";
  return trimmed.replace(/\/(?:home|mnt|tmp|Users)\/\S+/g, "that-command").slice(0, 80);
}

function publicIssueLine(issue: string): string {
  return issue
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s"'`]+/g, "that folder")
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "…")
    .slice(0, 160);
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

export function resolveLiveApprovalEligibility(input: {
  runStatus: string;
  report: {
    canApprove: boolean;
    recommendedNextAction?: string;
    governanceIssues?: string[];
    qualityGateResults?: Array<{ command?: string; status?: string }>;
    riskLevel?: string;
  } | null;
}): ReturnType<typeof describeApprovalEligibility> {
  if (!input.report) return describeApprovalEligibility(null);
  const gatesOk = gatesPassed(
    (input.report.qualityGateResults ?? []) as QualityGateResult[],
  );
  const canApprove =
    input.runStatus === "waiting_for_approval" &&
    input.report.riskLevel !== "blocked" &&
    gatesOk;
  return describeApprovalEligibility({
    ...input.report,
    canApprove,
    runStatus: input.runStatus,
  });
}
