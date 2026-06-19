import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getIndexedFilePathSet } from "../../repo-intelligence/file-index/list-indexed-files";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport } from "../../types";
import {
  getLatestWorkerPlanForRun,
  parseValidationErrors,
} from "../../worker-plan/worker-plan-manager";
import { getLatestWorkerPlanDraftForRun } from "../../worker-plan/worker-plan-draft-manager";
import type { GovernanceAssessment } from "../governance-engine";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../decision-records/decision-record-manager";
import { getLatestReplayVerificationResult } from "../replay-verification/replay-verification-manager";
import { getCompatibilitySummaryForRepo } from "../../repo-intelligence/compatibility/compatibility-manager";
import { DEFAULT_ENGINEERING_POLICY } from "./default-engineering-policy";
import { hashPolicyDefinition } from "./hash-policy";
import type {
  EngineeringPolicyDefinition,
  PolicyEvaluationResult,
  PolicyEvaluationSignals,
  PolicyResultStatus,
  PolicyRuleResult,
} from "./policy-types";
import { PolicyEvaluationError } from "./policy-types";

function pass(ruleId: string, message: string): PolicyRuleResult {
  return { ruleId, outcome: "pass", message };
}

function block(ruleId: string, message: string, details?: Record<string, unknown>): PolicyRuleResult {
  return { ruleId, outcome: "block", message, details };
}

function warn(ruleId: string, message: string, details?: Record<string, unknown>): PolicyRuleResult {
  return { ruleId, outcome: "warn", message, details };
}

function review(ruleId: string, message: string, details?: Record<string, unknown>): PolicyRuleResult {
  return { ruleId, outcome: "review", message, details };
}

function parseGovernanceNotes(notes: string | null): GovernanceAssessment | null {
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

function fileMatchesPattern(file: string, pattern: RegExp): boolean {
  return pattern.test(normalizePath(file));
}

function collectSignals(runId: string): {
  signals: PolicyEvaluationSignals;
  approvalReport: ApprovalReport | null;
  governance: GovernanceAssessment | null;
} {
  const run = getRunById(runId);
  if (!run) {
    throw new PolicyEvaluationError(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new PolicyEvaluationError(`Task not found for run: ${runId}`);
  }

  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const governance =
    parseGovernanceNotes(run.governanceNotes) ??
    (approvalReport
      ? {
          riskLevel: approvalReport.riskLevel,
          issues: approvalReport.governanceIssues,
          blockedFiles: approvalReport.governanceIssues
            .filter((i) => i.includes("Blocked change"))
            .map((i) => i.replace(/^Blocked change to protected path: /, "").split(" ")[0] ?? i),
          canApprove: approvalReport.canApprove,
        }
      : null);

  const gates = getQualityGateResultsForRun(runId);
  const evidence = getEvidenceBundleForRun(runId);
  const decisions = listDecisionRecords(runId);
  const replay = getLatestReplayVerificationResult(runId);

  const workerPlan = getLatestWorkerPlanForRun(runId);
  const draft = getLatestWorkerPlanDraftForRun(runId);

  const changedFiles = approvalReport?.changedFiles ?? [];
  const indexedMismatchCount = workerPlan
    ? parseValidationErrors(workerPlan.validationWarningsJson).filter(
        (w) => w.code === "FILE_NOT_IN_INDEX",
      ).length
    : 0;

  let unindexedModifiedCount = 0;
  if (task.registeredRepoId && changedFiles.length > 0) {
    const indexedPaths = getIndexedFilePathSet(task.registeredRepoId);
    if (indexedPaths.size > 0) {
      unindexedModifiedCount = changedFiles.filter((f) => !indexedPaths.has(normalizePath(f))).length;
    }
  }

  const packageLockChanged = changedFiles.some((f) =>
    fileMatchesPattern(f, /(^|\/)package-lock\.json$/i),
  );
  const migrationsChanged = changedFiles.some((f) =>
    fileMatchesPattern(f, /(^|\/)(migrations?|db\/migrate)\//i),
  );

  const latestDecision = decisions.length > 0 ? decisions[decisions.length - 1]! : null;
  const evidenceRegeneratedAfterDecision =
    evidence !== null &&
    latestDecision !== null &&
    evidence.updatedAt > latestDecision.createdAt;

  const draftValidationIssue =
    draft !== null &&
    (draft.validationStatus === "invalid" || draft.validationStatus === "parse_failed") &&
    workerPlan !== null &&
    workerPlan.validationStatus === "valid";

  const compatibility = task.registeredRepoId
    ? getCompatibilitySummaryForRepo(task.registeredRepoId)
    : null;

  const signals: PolicyEvaluationSignals = {
    runStatus: run.status,
    workerPlanValidationStatus: workerPlan?.validationStatus ?? approvalReport?.workerPlan?.validationStatus ?? null,
    governanceRiskLevel: governance?.riskLevel ?? run.riskLevel ?? null,
    blockedFileCount: governance?.blockedFiles?.length ?? 0,
    changedFileCount: changedFiles.length,
    qualityGatesFailed: gates.filter((g) => g.status === "failed").length,
    qualityGatesSkipped: gates.filter((g) => g.status === "skipped").length,
    qualityGatesPassed: gates.filter((g) => g.status === "passed").length,
    evidenceBundlePresent: evidence !== null,
    evidenceBundleUpdatedAfterDecision: evidenceRegeneratedAfterDecision,
    decisionRecordCount: decisions.length,
    latestDecision: latestDecision?.decision ?? null,
    replayVerificationStatus: replay?.status ?? null,
    replayVerificationFailedChecks: replay?.summary.failed ?? 0,
    replayVerificationWarningChecks: replay?.summary.warnings ?? 0,
    indexedFileMismatchCount: indexedMismatchCount,
    unindexedModifiedCount,
    packageLockChanged,
    migrationsChanged,
    draftValidationIssue,
    compatibilityBreakingCount: compatibility?.breakingCount ?? 0,
    compatibilityWarningCount: compatibility?.warningCount ?? 0,
    compatibilityUnknownCount: compatibility?.unknownCount ?? 0,
  };

  return { signals, approvalReport, governance };
}

function evaluateRules(
  policy: EngineeringPolicyDefinition,
  signals: PolicyEvaluationSignals,
): PolicyRuleResult[] {
  const results: PolicyRuleResult[] = [];

  for (const rule of policy.rules) {
    switch (rule.id) {
      case "WORKER_PLAN_VALIDATION_FAILED":
        results.push(
          signals.workerPlanValidationStatus === "invalid"
            ? block(rule.id, "Worker plan validation failed.")
            : pass(rule.id, "Worker plan validation acceptable."),
        );
        break;
      case "GOVERNANCE_BLOCKED":
        results.push(
          signals.governanceRiskLevel === "blocked"
            ? block(rule.id, "Governance risk level is blocked.")
            : pass(rule.id, "Governance risk is not blocked."),
        );
        break;
      case "PROTECTED_PATH_BLOCKED":
        results.push(
          signals.blockedFileCount > 0
            ? block(rule.id, "Protected path changes detected.", {
                blockedFileCount: signals.blockedFileCount,
              })
            : pass(rule.id, "No blocked protected paths."),
        );
        break;
      case "QUALITY_GATE_FAILED":
        results.push(
          signals.qualityGatesFailed > 0
            ? block(rule.id, "Quality gate failures detected.", {
                failed: signals.qualityGatesFailed,
              })
            : pass(rule.id, "Quality gates passed or skipped acceptably."),
        );
        break;
      case "REPLAY_VERIFICATION_FAILED":
        results.push(
          signals.replayVerificationStatus === "failed"
            ? block(rule.id, "Replay verification failed.", {
                failedChecks: signals.replayVerificationFailedChecks,
              })
            : pass(rule.id, "Replay verification did not fail."),
        );
        break;
      case "EVIDENCE_BUNDLE_MISSING":
        results.push(
          !signals.evidenceBundlePresent &&
            (signals.runStatus === "waiting_for_approval" || signals.runStatus === "completed")
            ? block(rule.id, "Evidence bundle missing for approval-ready run.")
            : pass(rule.id, "Evidence bundle present or not yet required."),
        );
        break;
      case "GOVERNANCE_HIGH_RISK":
        results.push(
          signals.governanceRiskLevel === "high"
            ? warn(rule.id, "Governance risk level is high.")
            : pass(rule.id, "Governance risk is not high."),
        );
        break;
      case "LARGE_CHANGE_SET":
        results.push(
          signals.changedFileCount > 20
            ? warn(rule.id, `Large change set: ${signals.changedFileCount} files.`, {
                changedFileCount: signals.changedFileCount,
              })
            : pass(rule.id, "Change set size within warning threshold."),
        );
        break;
      case "INDEXED_FILE_MISMATCH":
        results.push(
          signals.indexedFileMismatchCount > 0
            ? warn(rule.id, "Worker plan references files not in latest index.", {
                count: signals.indexedFileMismatchCount,
              })
            : pass(rule.id, "No indexed-file mismatch warnings."),
        );
        break;
      case "REPLAY_VERIFICATION_WARNINGS":
        results.push(
          signals.replayVerificationWarningChecks > 0
            ? warn(rule.id, "Replay verification reported warnings.", {
                warnings: signals.replayVerificationWarningChecks,
              })
            : pass(rule.id, "No replay verification warnings."),
        );
        break;
      case "EVIDENCE_REGENERATED_AFTER_DECISION":
        results.push(
          signals.evidenceBundleUpdatedAfterDecision
            ? warn(rule.id, "Evidence bundle regenerated after human decision.")
            : pass(rule.id, "Evidence bundle not regenerated after decision."),
        );
        break;
      case "COMPATIBILITY_WARNINGS":
        results.push(
          signals.compatibilityWarningCount > 0 || signals.compatibilityUnknownCount > 0
            ? warn(rule.id, "Compatibility warnings or unknown links detected.", {
                warnings: signals.compatibilityWarningCount,
                unknown: signals.compatibilityUnknownCount,
              })
            : pass(rule.id, "No compatibility warnings."),
        );
        break;
      case "COMPATIBILITY_BREAKING":
        results.push(
          signals.compatibilityBreakingCount > 0
            ? review(rule.id, "Breaking cross-repo compatibility links detected.", {
                count: signals.compatibilityBreakingCount,
              })
            : pass(rule.id, "No breaking compatibility links."),
        );
        break;
      case "GOVERNANCE_HIGH_RISK_REVIEW":
        results.push(
          signals.governanceRiskLevel === "high"
            ? review(rule.id, "High governance risk requires senior review.")
            : pass(rule.id, "Senior review not required for governance risk."),
        );
        break;
      case "PACKAGE_LOCK_CHANGED":
        results.push(
          signals.packageLockChanged
            ? review(rule.id, "package-lock.json changed.")
            : pass(rule.id, "package-lock.json unchanged."),
        );
        break;
      case "MIGRATIONS_CHANGED":
        results.push(
          signals.migrationsChanged
            ? review(rule.id, "Database migrations changed.")
            : pass(rule.id, "No migration changes detected."),
        );
        break;
      case "UNINDEXED_TARGETS_MODIFIED":
        results.push(
          signals.unindexedModifiedCount > 0
            ? review(rule.id, "Modified files not present in latest file index.", {
                count: signals.unindexedModifiedCount,
              })
            : pass(rule.id, "All modified targets indexed or index unavailable."),
        );
        break;
      case "QUALITY_GATES_ALL_SKIPPED":
        results.push(
          signals.qualityGatesSkipped > 0 &&
            signals.qualityGatesFailed === 0 &&
            signals.qualityGatesPassed === 0
            ? review(rule.id, "All quality gates skipped (no scripts detected).")
            : pass(rule.id, "Quality gates executed or not applicable."),
        );
        break;
      case "DRAFT_MANUAL_CORRECTION":
        results.push(
          signals.draftValidationIssue
            ? review(rule.id, "Model draft required manual correction before execution.")
            : pass(rule.id, "No manual draft correction required."),
        );
        break;
      case "REPLAY_NOT_VERIFIED":
        results.push(
          signals.runStatus === "waiting_for_approval" && signals.replayVerificationStatus === null
            ? review(rule.id, "Replay verification not yet performed for approval-ready run.")
            : pass(rule.id, "Replay verification present or not yet required."),
        );
        break;
      default:
        results.push(pass(rule.id, `Unknown rule ${rule.id} skipped.`));
    }
  }

  return results;
}

function aggregateStatus(
  blockers: string[],
  warnings: string[],
  reviewRequired: string[],
): PolicyResultStatus {
  if (blockers.length > 0) return "blocked";
  if (reviewRequired.length > 0) return "requires_review";
  if (warnings.length > 0) return "warning";
  return "passed";
}

function recommendNextAction(status: PolicyResultStatus, blockers: string[], reviewRequired: string[]): string {
  if (status === "blocked") {
    return blockers[0] ?? "Resolve policy blockers before approval.";
  }
  if (status === "requires_review") {
    return reviewRequired[0] ?? "Senior review required before approval.";
  }
  if (status === "warning") {
    return "Review warnings, then approve or request fix.";
  }
  return "Policy checks passed. Proceed with human approval if other gates allow.";
}

export function evaluateRunPolicy(
  runId: string,
  policy: EngineeringPolicyDefinition = DEFAULT_ENGINEERING_POLICY,
): PolicyEvaluationResult {
  const { signals } = collectSignals(runId);
  const rules = evaluateRules(policy, signals);

  const blockers = rules.filter((r) => r.outcome === "block").map((r) => r.message);
  const warnings = rules.filter((r) => r.outcome === "warn").map((r) => r.message);
  const reviewRequired = rules.filter((r) => r.outcome === "review").map((r) => r.message);
  const status = aggregateStatus(blockers, warnings, reviewRequired);

  const summary =
    status === "passed"
      ? "All policy checks passed."
      : `${blockers.length} blocker(s), ${reviewRequired.length} review item(s), ${warnings.length} warning(s).`;

  return {
    runId,
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: policy.version,
    policyHash: hashPolicyDefinition(policy),
    status,
    summary,
    evaluatedAt: new Date().toISOString(),
    rules,
    blockers,
    warnings,
    reviewRequired,
    signals,
    recommendedNextAction: recommendNextAction(status, blockers, reviewRequired),
  };
}

export { collectSignals };
