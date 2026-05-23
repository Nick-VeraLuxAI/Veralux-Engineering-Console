import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getCompatibilitySummaryForRepo } from "../../repo-intelligence/compatibility/compatibility-manager";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport } from "../../types";
import {
  getLatestWorkerPlanForRun,
  listWorkerOperations,
} from "../../worker-plan/worker-plan-manager";
import type { GovernanceAssessment } from "../governance-engine";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../decision-records/decision-record-manager";
import { getLatestPolicyEvaluationResult } from "../policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../replay-verification/replay-verification-manager";
import type { RequiredReviewStageSpec, ReviewStageType } from "./review-stage-types";

function parseGovernance(notes: string | null): GovernanceAssessment | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as GovernanceAssessment;
  } catch {
    return null;
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileMatches(file: string, pattern: RegExp): boolean {
  return pattern.test(normalizePath(file));
}

function addSpec(
  specs: Map<ReviewStageType, RequiredReviewStageSpec>,
  stage: ReviewStageType,
  required: boolean,
  reason: string,
): void {
  const existing = specs.get(stage);
  if (existing) {
    if (required && !existing.required) {
      specs.set(stage, { stage, required: true, reason: `${existing.reason}; ${reason}` });
    } else if (required) {
      specs.set(stage, { stage, required: true, reason: `${existing.reason}; ${reason}` });
    }
    return;
  }
  specs.set(stage, { stage, required, reason });
}

export function determineRequiredReviewStages(runId: string): RequiredReviewStageSpec[] {
  const run = getRunById(runId);
  if (!run) return [];

  const task = getTaskById(run.taskId);
  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const governance =
    parseGovernance(run.governanceNotes) ??
    (approvalReport
      ? {
          riskLevel: approvalReport.riskLevel,
          issues: approvalReport.governanceIssues,
          blockedFiles: [],
          canApprove: approvalReport.canApprove,
        }
      : null);

  const changedFiles = approvalReport?.changedFiles ?? [];
  const gates = getQualityGateResultsForRun(runId);
  const policy = getLatestPolicyEvaluationResult(runId);
  const replay = getLatestReplayVerificationResult(runId);
  const compatibility = task?.registeredRepoId
    ? getCompatibilitySummaryForRepo(task.registeredRepoId)
    : null;
  const evidence = getEvidenceBundleForRun(runId);
  const decisions = listDecisionRecords(runId);
  const latestDecision = decisions.length > 0 ? decisions[decisions.length - 1]! : null;
  const evidenceRegeneratedAfterDecision =
    evidence !== null && latestDecision !== null && evidence.updatedAt > latestDecision.createdAt;

  const workerPlan = getLatestWorkerPlanForRun(runId);
  const ops = workerPlan ? listWorkerOperations(workerPlan.id) : [];

  const packageLockChanged = changedFiles.some((f) =>
    fileMatches(f, /(^|\/)package-lock\.json$/i),
  );
  const migrationsChanged = changedFiles.some((f) =>
    fileMatches(f, /(^|\/)(migrations?|db\/migrate)\//i),
  );
  const largeChangeSet = changedFiles.length > 20;
  const riskLevel = governance?.riskLevel ?? run.riskLevel ?? "low";
  const gatesFailed = gates.some((g) => g.status === "failed");
  const gatesSkippedOnly =
    gates.length > 0 &&
    gates.every((g) => g.status === "skipped") &&
    !gates.some((g) => g.status === "passed");
  const protectedWarnings =
    (governance?.issues ?? []).some((i) => i.includes("Risky change")) ||
    (governance?.blockedFiles.length ?? 0) > 0;

  const compatibilityNeedsReview =
    (compatibility?.breakingCount ?? 0) > 0 ||
    (policy?.status === "requires_review" &&
      (policy.reviewRequired.some((r) => r.includes("compatibility")) ||
        policy.reviewRequired.some((r) => r.includes("COMPATIBILITY"))));

  const crossRepoLinksAffected = (compatibility?.linkCount ?? 0) > 0;

  const specs = new Map<ReviewStageType, RequiredReviewStageSpec>();

  if (
    compatibilityNeedsReview ||
    migrationsChanged ||
    crossRepoLinksAffected ||
    (policy?.status === "requires_review" &&
      policy.reviewRequired.some(
        (r) =>
          r.includes("migration") ||
          r.includes("compatibility") ||
          r.includes("Senior review") ||
          r.includes("architecture"),
      ))
  ) {
    addSpec(
      specs,
      "architecture_review",
      true,
      "Architecture-level compatibility, migration, or cross-repo signals detected.",
    );
  }

  const importantSourceTouched = ops.some(
    (op) =>
      (op.operationType === "update_file" || op.operationType === "append_file") &&
      /^(src|lib|server|app)\//i.test(op.path),
  );
  const workerPlanExecuted =
    workerPlan !== null &&
    workerPlan.executionStatus === "executed" &&
    changedFiles.length > 0;

  if (workerPlanExecuted && (largeChangeSet || importantSourceTouched || changedFiles.length > 0)) {
    addSpec(
      specs,
      "implementation_review",
      true,
      "Worker plan executed with file changes requiring implementation review.",
    );
  }

  if (
    packageLockChanged ||
    migrationsChanged ||
    protectedWarnings ||
    largeChangeSet ||
    riskLevel === "high" ||
    riskLevel === "blocked"
  ) {
    addSpec(
      specs,
      "risky_diff_review",
      true,
      "Risky diff signals: protected paths, lockfile, migrations, large change set, or elevated governance risk.",
    );
  }

  if (
    gatesSkippedOnly ||
    gatesFailed ||
    replay?.status === "warning" ||
    replay?.status === "failed" ||
    policy?.status === "requires_review" ||
    evidenceRegeneratedAfterDecision
  ) {
    addSpec(
      specs,
      "release_readiness_review",
      true,
      "Release readiness signals: quality gates, replay verification, policy review, or evidence drift.",
    );
  }

  if (policy?.status === "requires_review" && specs.size === 0) {
    addSpec(
      specs,
      "release_readiness_review",
      true,
      "Policy evaluation requires senior review before approval.",
    );
  }

  if (policy?.status === "passed" || policy?.status === "warning") {
    if (specs.size === 0) {
      return [];
    }
  }

  return Array.from(specs.values());
}
