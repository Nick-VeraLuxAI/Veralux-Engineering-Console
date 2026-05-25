export const HARD_RELEASE_GATE_ACTIONS = [
  "merge",
  "deployment_execution",
  "deployment_approval_approve",
  "release_signoff_completed",
  "release_signoff_completed_with_exceptions",
] as const;

export type HardReleaseGateAction = (typeof HARD_RELEASE_GATE_ACTIONS)[number];

export type HardReleaseGateStatus = "passed" | "blocked";

export interface HardReleaseGateEvaluation {
  enabled: boolean;
  action: HardReleaseGateAction;
  status: HardReleaseGateStatus;
  blockers: string[];
  recommendedAction: string | null;
  signals: {
    checklistStatus: string | null;
    signoffDecision: string | null;
    healthPolicyStatus: string | null;
    policyStatus: string | null;
    replayStatus: string | null;
    hasEvidenceBundle: boolean;
    hasApprovedDeploymentApproval: boolean;
  };
}

export class ReleaseGateError extends Error {
  readonly evaluation: HardReleaseGateEvaluation;

  constructor(message: string, evaluation: HardReleaseGateEvaluation) {
    super(message);
    this.name = "ReleaseGateError";
    this.evaluation = evaluation;
  }
}
