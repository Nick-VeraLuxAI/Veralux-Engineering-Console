/** Three-gate separation and no-action invariants for S16. */

import type { QualityReportDecisionContext } from "./types";
import { S16_ARCHITECTURE } from "./types";

export type GateKind =
  | "senior_execution_approval"
  | "senior_review_acceptance"
  | "quality_report_operator_decision";

export function assertGatesAreSeparate(attempt: {
  usingExecutionApprovalAsAcceptance?: boolean;
  usingAcceptanceAsLifecycleDecision?: boolean;
  usingExecutionApprovalAsLifecycleDecision?: boolean;
}): void {
  if (attempt.usingExecutionApprovalAsAcceptance) {
    throw new Error("gate_substitution_forbidden:execution_approval_is_not_acceptance");
  }
  if (attempt.usingAcceptanceAsLifecycleDecision) {
    throw new Error("gate_substitution_forbidden:acceptance_is_not_lifecycle_decision");
  }
  if (attempt.usingExecutionApprovalAsLifecycleDecision) {
    throw new Error("gate_substitution_forbidden:execution_approval_is_not_lifecycle_decision");
  }
}

export function assertSeniorCannotChangeLifecycle(context: QualityReportDecisionContext): void {
  if (context.lifecycleEffect.appliedBySenior) {
    throw new Error("senior_must_not_apply_lifecycle");
  }
  if (
    context.seniorReview?.accepted &&
    !context.operatorDecision &&
    context.lifecycleEffect.qualityReportDecision !== "pending"
  ) {
    throw new Error("accepted_senior_must_not_set_quality_report_decision");
  }
  if (
    context.seniorReview?.accepted &&
    !context.operatorDecision &&
    context.lifecycleEffect.downstreamEligible
  ) {
    throw new Error("accepted_senior_must_not_set_downstream_eligible");
  }
}

export type ForbiddenAction =
  | "apply_patch"
  | "git_commit"
  | "create_pr"
  | "merge"
  | "deploy"
  | "send_external_message"
  | "modify_other_lifecycle_gate";

export type ActionAttemptResult = {
  allowed: false;
  reason: "s16_no_action_boundary";
  message: string;
  counters: Record<ForbiddenAction, 0>;
};

const ZERO_COUNTERS: Record<ForbiddenAction, 0> = {
  apply_patch: 0,
  git_commit: 0,
  create_pr: 0,
  merge: 0,
  deploy: 0,
  send_external_message: 0,
  modify_other_lifecycle_gate: 0,
};

export function assertNoAction(action: ForbiddenAction): ActionAttemptResult {
  return {
    allowed: false,
    reason: "s16_no_action_boundary",
    message: `S16 forbids ${action}; only quality-report operator decision is in scope`,
    counters: { ...ZERO_COUNTERS },
  };
}

export function assertArchitectureInvariants(): void {
  if (S16_ARCHITECTURE.allocatesCuda) throw new Error("s16_must_not_allocate_cuda");
  if (S16_ARCHITECTURE.stopsNano) throw new Error("s16_must_not_stop_nano");
  if (S16_ARCHITECTURE.importsModelLoading) throw new Error("s16_must_not_import_model_loading");
  if (S16_ARCHITECTURE.automaticSeniorSelection) throw new Error("s16_no_automatic_senior");
  if (S16_ARCHITECTURE.defaultSeniorRoute) throw new Error("s16_no_default_senior_route");
  if (S16_ARCHITECTURE.nativeFp8KernelProven) throw new Error("s16_native_fp8_must_remain_unproven");
  if (S16_ARCHITECTURE.seniorMayChangeRunState) throw new Error("s16_senior_must_not_change_run_state");
  if (S16_ARCHITECTURE.seniorMayAuthorizeDownstreamActions) {
    throw new Error("s16_senior_must_not_authorize_downstream");
  }
  if (!S16_ARCHITECTURE.usesS15NotS14OrS13Direct) {
    throw new Error("s16_must_use_s15_only");
  }
}
