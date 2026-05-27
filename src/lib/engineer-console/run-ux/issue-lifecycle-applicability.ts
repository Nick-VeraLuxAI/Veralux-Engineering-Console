import {
  RUN_LIFECYCLE_STEPS,
  type RunCommandCenterState,
  type RunLifecycleStepId,
  type RunWorkflowSummary,
} from "./run-ux-types";

export type CurrentApplicability =
  | "active_now"
  | "future_requirement"
  | "historical_context"
  | "resolved"
  | "stale"
  | "not_applicable";

export type OperatorSeverity = "info" | "warning" | "blocker" | "critical";

export type RunIssueDisplaySeverity = "critical" | "warning" | "info";

export type RunIssueKind =
  | "audit_chain_failed"
  | "audit_chain_inconsistent"
  | "audit_scope_notice"
  | "audit_verification_pending"
  | "hard_release_gates_blocked"
  | "evidence_missing"
  | "replay_missing"
  | "replay_failed"
  | "replay_warning"
  | "policy_missing"
  | "policy_blocked"
  | "policy_requires_review"
  | "review_stages_rejected"
  | "review_stages_pending"
  | "approval_rationale_required"
  | "approval_pending"
  | "approval_blocked"
  | "pr_retry_available"
  | "pr_failed"
  | "pr_ready"
  | "deployment_health_warning"
  | "release_checklist_missing"
  | "release_checklist_attention"
  | "release_signoff_missing"
  | "worker_plan_validation"
  | "worker_plan_execution";

const LIFECYCLE_INDEX = new Map<RunLifecycleStepId, number>(
  RUN_LIFECYCLE_STEPS.map((step, index) => [step, index]),
);

export function lifecycleStageIndex(stageId: RunLifecycleStepId): number {
  return LIFECYCLE_INDEX.get(stageId) ?? 0;
}

export function isLifecycleStageAtOrAfter(
  currentStageId: RunLifecycleStepId,
  minimumStageId: RunLifecycleStepId,
): boolean {
  return lifecycleStageIndex(currentStageId) >= lifecycleStageIndex(minimumStageId);
}

export function applicableFromStageForIssue(kind: RunIssueKind): RunLifecycleStepId {
  switch (kind) {
    case "worker_plan_validation":
    case "worker_plan_execution":
    case "audit_chain_failed":
    case "audit_chain_inconsistent":
    case "audit_scope_notice":
    case "audit_verification_pending":
      return "worker_plan";
    case "evidence_missing":
      return "evidence";
    case "replay_missing":
    case "replay_failed":
    case "replay_warning":
      return "replay";
    case "policy_missing":
    case "policy_blocked":
    case "policy_requires_review":
      return "policy";
    case "review_stages_rejected":
    case "review_stages_pending":
      return "review";
    case "approval_rationale_required":
    case "approval_pending":
    case "approval_blocked":
      return "approval";
    case "pr_retry_available":
    case "pr_failed":
    case "pr_ready":
      return "pr";
    case "hard_release_gates_blocked":
      return "merge";
    case "deployment_health_warning":
      return "health";
    case "release_checklist_missing":
    case "release_checklist_attention":
      return "checklist";
    case "release_signoff_missing":
      return "signoff";
    default:
      return "task";
  }
}

export function toDisplaySeverity(
  operatorSeverity: OperatorSeverity,
  applicability: CurrentApplicability,
): RunIssueDisplaySeverity {
  if (applicability === "future_requirement") {
    return "info";
  }
  if (applicability === "historical_context" || applicability === "stale") {
    return operatorSeverity === "critical" || operatorSeverity === "blocker" ? "warning" : "info";
  }
  if (applicability === "resolved" || applicability === "not_applicable") {
    return "info";
  }

  switch (operatorSeverity) {
    case "critical":
      return "critical";
    case "blocker":
      return "critical";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

export function resolveIssueApplicability(input: {
  kind: RunIssueKind;
  currentStageId: RunLifecycleStepId;
  operatorSeverity: OperatorSeverity;
  summary: RunWorkflowSummary;
  guidance: RunCommandCenterState;
  /** When true, the underlying signal is recorded even though the lifecycle has not reached the gate yet. */
  signalRecorded?: boolean;
}): CurrentApplicability {
  const { kind, currentStageId, summary, guidance, signalRecorded = true } = input;
  const minimumStage = applicableFromStageForIssue(kind);

  if (!signalRecorded) {
    return "not_applicable";
  }

  if (kind === "hard_release_gates_blocked") {
    return isLifecycleStageAtOrAfter(currentStageId, "merge")
      ? "active_now"
      : "future_requirement";
  }

  if (kind === "approval_pending" || kind === "approval_blocked" || kind === "approval_rationale_required") {
    if (summary.run.status !== "waiting_for_approval") {
      return guidance.currentStageId === "approval" ? "stale" : "not_applicable";
    }
    return isLifecycleStageAtOrAfter(currentStageId, "approval") ? "active_now" : "future_requirement";
  }

  if (kind === "policy_blocked") {
    if (summary.policy.exists && summary.policy.status === "blocked") {
      return "active_now";
    }
    return isLifecycleStageAtOrAfter(currentStageId, minimumStage)
      ? "active_now"
      : "future_requirement";
  }

  if (kind === "policy_missing") {
    return isLifecycleStageAtOrAfter(currentStageId, minimumStage) ? "active_now" : "future_requirement";
  }

  if (kind === "replay_missing") {
    return isLifecycleStageAtOrAfter(currentStageId, minimumStage) ? "active_now" : "future_requirement";
  }

  if (
    kind === "audit_chain_failed" ||
    kind === "audit_chain_inconsistent" ||
    kind === "audit_scope_notice" ||
    kind === "audit_verification_pending"
  ) {
    return classifyAuditApplicability(kind, summary, currentStageId).applicability;
  }

  if (kind === "release_checklist_missing") {
    return guidance.currentStageId === "checklist" ? "active_now" : "future_requirement";
  }

  if (kind === "pr_ready") {
    return guidance.currentStageId === "pr" ? "active_now" : "future_requirement";
  }

  if (isLifecycleStageAtOrAfter(currentStageId, minimumStage)) {
    return "active_now";
  }

  return "future_requirement";
}

function isScopeOnlyAuditFailure(failure: string): boolean {
  return (
    failure.startsWith("duplicate_previous_hash:") || failure.startsWith("duplicate_chain_hash:")
  );
}

export function classifyAuditApplicability(
  kind: RunIssueKind,
  summary: RunWorkflowSummary,
  currentStageId: RunLifecycleStepId,
): { applicability: CurrentApplicability; operatorSeverity: OperatorSeverity } {
  const { audit } = summary;
  const scopeFailures = audit.chainFailures.filter(isScopeOnlyAuditFailure);
  const runFailures = audit.chainFailures.filter((failure) => !isScopeOnlyAuditFailure(failure));

  if (kind === "audit_verification_pending") {
    if (audit.eventCount === 0) {
      return {
        applicability: isLifecycleStageAtOrAfter(currentStageId, "worker_plan")
          ? "future_requirement"
          : "not_applicable",
        operatorSeverity: "info",
      };
    }
    return { applicability: "not_applicable", operatorSeverity: "info" };
  }

  if (kind === "audit_scope_notice") {
    if (scopeFailures.length === 0) {
      return { applicability: "not_applicable", operatorSeverity: "info" };
    }
    if (runFailures.length > 0) {
      return { applicability: "not_applicable", operatorSeverity: "info" };
    }
    return {
      applicability: audit.chainOk ? "resolved" : "historical_context",
      operatorSeverity: "warning",
    };
  }

  if (kind === "audit_chain_inconsistent") {
    if (scopeFailures.length > 0 && runFailures.length > 0 && !audit.chainOk) {
      return { applicability: "active_now", operatorSeverity: "critical" };
    }
    return { applicability: "not_applicable", operatorSeverity: "info" };
  }

  if (kind === "audit_chain_failed") {
    if (audit.chainOk) {
      return { applicability: "resolved", operatorSeverity: "info" };
    }
    if (audit.eventCount === 0 && runFailures.length === 0) {
      return { applicability: "not_applicable", operatorSeverity: "info" };
    }
    if (runFailures.length > 0) {
      return { applicability: "active_now", operatorSeverity: "critical" };
    }
    if (scopeFailures.length > 0) {
      return { applicability: "historical_context", operatorSeverity: "warning" };
    }
    return { applicability: "active_now", operatorSeverity: "critical" };
  }

  return { applicability: "not_applicable", operatorSeverity: "info" };
}

export interface RunIssueAttentionCounts {
  activeBlockerCount: number;
  activeWarningCount: number;
  activeInfoCount: number;
  futureRequirementCount: number;
  historicalCount: number;
}

export function summarizeRunIssueAttention<T extends { severity: RunIssueDisplaySeverity; applicability: CurrentApplicability }>(
  issues: T[],
): RunIssueAttentionCounts {
  const counts: RunIssueAttentionCounts = {
    activeBlockerCount: 0,
    activeWarningCount: 0,
    activeInfoCount: 0,
    futureRequirementCount: 0,
    historicalCount: 0,
  };

  for (const issue of issues) {
    if (issue.applicability === "future_requirement") {
      counts.futureRequirementCount += 1;
      continue;
    }
    if (issue.applicability === "historical_context" || issue.applicability === "stale") {
      counts.historicalCount += 1;
      continue;
    }
    if (issue.applicability !== "active_now") {
      continue;
    }

    if (issue.severity === "critical") {
      counts.activeBlockerCount += 1;
    } else if (issue.severity === "warning") {
      counts.activeWarningCount += 1;
    } else {
      counts.activeInfoCount += 1;
    }
  }

  return counts;
}
