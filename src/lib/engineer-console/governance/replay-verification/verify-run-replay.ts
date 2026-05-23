import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { listDecisionRecords } from "../decision-records/decision-record-manager";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import type {
  ReplayCheck,
  ReplayVerificationResult,
  ReplayVerificationStatus,
  ReplayVerificationSummary,
} from "./replay-verification-types";
import { ReplayVerificationError } from "./replay-verification-types";
import { verifyDecisionRecords } from "./verify-decision-records";
import { verifyReviewStagesAtApproval } from "./verify-review-stages";
import { verifyEvidenceBundleChecks } from "./verify-evidence-bundle";
import {
  verifyAuditChainCheck,
  verifyFinalStateConsistency,
  verifyGovernanceConsistency,
  verifyQualityGateConsistency,
  verifyWorkerPlanConsistency,
} from "./verify-run-consistency";

function summarizeChecks(checks: ReplayCheck[]): ReplayVerificationSummary {
  return {
    passed: checks.filter((c) => c.status === "passed").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    failed: checks.filter((c) => c.status === "failed").length,
  };
}

function aggregateStatus(summary: ReplayVerificationSummary): ReplayVerificationStatus {
  if (summary.failed > 0) return "failed";
  if (summary.warnings > 0) return "warning";
  return "passed";
}

export function verifyRunReplay(runId: string): ReplayVerificationResult {
  const run = getRunById(runId);
  if (!run) {
    throw new ReplayVerificationError(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new ReplayVerificationError(`Task not found for run: ${runId}`);
  }

  const decisionRecords = listDecisionRecords(runId);
  const evidence = getEvidenceBundleForRun(runId);

  const checks: ReplayCheck[] = [
    verifyAuditChainCheck(runId),
    ...verifyEvidenceBundleChecks(runId, run.status, decisionRecords.length > 0),
    ...verifyDecisionRecords(runId, decisionRecords),
    ...verifyReviewStagesAtApproval(runId, decisionRecords),
    verifyQualityGateConsistency(runId, evidence),
    verifyGovernanceConsistency(run, evidence),
    verifyWorkerPlanConsistency(evidence),
    verifyFinalStateConsistency(run, decisionRecords),
  ];

  const summary = summarizeChecks(checks);
  const status = aggregateStatus(summary);

  return {
    ok: status === "passed",
    runId,
    checkedAt: new Date().toISOString(),
    status,
    checks,
    summary,
  };
}
