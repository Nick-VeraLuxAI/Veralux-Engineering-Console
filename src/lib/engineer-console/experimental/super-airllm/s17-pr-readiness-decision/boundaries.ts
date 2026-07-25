/** Four-gate separation and no-action invariants for S17. */

import type { PrReadinessDecisionContext } from "./types";
import { S17_ARCHITECTURE } from "./types";

export type GateKind =
  | "senior_execution_approval"
  | "senior_review_acceptance"
  | "pr_readiness_operator_decision"
  | "pr_creation_approval";

export function assertGatesAreSeparate(attempt: {
  usingExecutionApprovalAsAcceptance?: boolean;
  usingAcceptanceAsReadinessDecision?: boolean;
  usingExecutionApprovalAsReadinessDecision?: boolean;
  usingReadinessDecisionAsPrCreation?: boolean;
  usingAcceptanceAsPrCreation?: boolean;
}): void {
  if (attempt.usingExecutionApprovalAsAcceptance) {
    throw new Error("gate_substitution_forbidden:execution_approval_is_not_acceptance");
  }
  if (attempt.usingAcceptanceAsReadinessDecision) {
    throw new Error("gate_substitution_forbidden:acceptance_is_not_readiness_decision");
  }
  if (attempt.usingExecutionApprovalAsReadinessDecision) {
    throw new Error("gate_substitution_forbidden:execution_approval_is_not_readiness_decision");
  }
  if (attempt.usingReadinessDecisionAsPrCreation) {
    throw new Error("gate_substitution_forbidden:readiness_decision_is_not_pr_creation");
  }
  if (attempt.usingAcceptanceAsPrCreation) {
    throw new Error("gate_substitution_forbidden:acceptance_is_not_pr_creation");
  }
}

export function assertSeniorCannotChangeLifecycle(context: PrReadinessDecisionContext): void {
  if (context.lifecycleEffect.appliedBySenior) {
    throw new Error("senior_must_not_apply_lifecycle");
  }
  if (context.lifecycleEffect.prCreationAuthorized) {
    throw new Error("senior_must_not_authorize_pr_creation");
  }
  if (
    context.seniorReview?.accepted &&
    !context.operatorDecision &&
    context.lifecycleEffect.prReadinessDecision !== "pending"
  ) {
    throw new Error("accepted_senior_must_not_set_pr_readiness_decision");
  }
}

export type ForbiddenAction =
  | "apply_patch"
  | "git_commit"
  | "push_branch"
  | "create_pr"
  | "approve_pr"
  | "merge"
  | "deploy"
  | "send_external_message"
  | "modify_other_lifecycle_gate";

export type ActionAttemptResult = {
  allowed: false;
  reason: "s17_no_action_boundary";
  message: string;
  counters: Record<ForbiddenAction, 0>;
};

const ZERO_COUNTERS: Record<ForbiddenAction, 0> = {
  apply_patch: 0,
  git_commit: 0,
  push_branch: 0,
  create_pr: 0,
  approve_pr: 0,
  merge: 0,
  deploy: 0,
  send_external_message: 0,
  modify_other_lifecycle_gate: 0,
};

export function assertNoAction(action: ForbiddenAction): ActionAttemptResult {
  return {
    allowed: false,
    reason: "s17_no_action_boundary",
    message: `S17 forbids ${action}; only PR-readiness operator decision is in scope. PR creation stays separately gated.`,
    counters: { ...ZERO_COUNTERS },
  };
}

export function assertArchitectureInvariants(): void {
  if (S17_ARCHITECTURE.allocatesCuda) throw new Error("s17_must_not_allocate_cuda");
  if (S17_ARCHITECTURE.stopsNano) throw new Error("s17_must_not_stop_nano");
  if (S17_ARCHITECTURE.importsModelLoading) throw new Error("s17_must_not_import_model_loading");
  if (S17_ARCHITECTURE.automaticSeniorSelection) throw new Error("s17_no_automatic_senior");
  if (S17_ARCHITECTURE.defaultSeniorRoute) throw new Error("s17_no_default_senior_route");
  if (S17_ARCHITECTURE.nativeFp8KernelProven) throw new Error("s17_native_fp8_must_remain_unproven");
  if (S17_ARCHITECTURE.seniorMayChangeRunState) throw new Error("s17_senior_must_not_change_run_state");
  if (S17_ARCHITECTURE.seniorMayAuthorizeDownstreamActions) {
    throw new Error("s17_senior_must_not_authorize_downstream");
  }
  if (S17_ARCHITECTURE.seniorMayCreatePullRequest) {
    throw new Error("s17_senior_must_not_create_pull_request");
  }
  if (!S17_ARCHITECTURE.prCreationRemainsSeparatelyGated) {
    throw new Error("s17_pr_creation_must_remain_separately_gated");
  }
  if (!S17_ARCHITECTURE.usesS15NotS14OrS13Direct) {
    throw new Error("s17_must_use_s15_only");
  }
}
