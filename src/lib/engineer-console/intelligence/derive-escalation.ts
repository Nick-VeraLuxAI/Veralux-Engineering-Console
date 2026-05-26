import type {
  DangerPoint,
  RunEscalationAssessment,
  RunRiskClassification,
} from "./danger-point-types";

export interface DeriveEscalationInput {
  dangerPoints: DangerPoint[];
  riskClassification: RunRiskClassification;
  qualityGates: {
    passedCount: number;
    failedCount: number;
  };
  replay: {
    status: string | null;
    warningCount: number;
    failedCount: number;
  };
  policy: {
    status: string | null;
  };
  review: {
    pendingCount: number;
    rejectedCount: number;
    requiredCount: number;
  };
  approval: {
    latestDecision: string | null;
  };
  pr: {
    latestStatus: string | null;
  };
  release: {
    checklistStatus: string | null;
    latestSignoffDecision: string | null;
  };
  hardGates: {
    mergeStatus: string | null;
    deploymentApprovalStatus: string | null;
    deploymentExecutionStatus: string | null;
    signoffCompletedStatus: string | null;
    signoffExceptionsStatus: string | null;
  };
}

export function deriveEscalation(input: DeriveEscalationInput): RunEscalationAssessment {
  let confidenceScore = 70;
  const criticalDanger = input.dangerPoints.some((point) => point.severity === "critical");
  const highDanger = input.dangerPoints.some((point) => point.severity === "high");
  const staleDanger = input.dangerPoints.some((point) => point.category === "freshness_staleness");
  const prRecoveryDanger = input.dangerPoints.some((point) => point.category === "pr_recovery");
  const releaseDanger = input.dangerPoints.some((point) => point.category === "release_governance");

  if (input.riskClassification.riskLevel === "low") confidenceScore += 8;
  if (input.qualityGates.failedCount === 0 && input.qualityGates.passedCount > 0) confidenceScore += 8;
  if (input.replay.status === "passed") confidenceScore += 6;
  if (input.policy.status === "passed") confidenceScore += 6;

  if (criticalDanger) confidenceScore -= 28;
  if (highDanger) confidenceScore -= 12;
  if (input.qualityGates.failedCount > 0) confidenceScore -= 15;
  if (input.replay.status === "warning") confidenceScore -= 10;
  if (input.replay.status === "failed") confidenceScore -= 18;
  if (input.policy.status === "requires_review") confidenceScore -= 12;
  if (input.policy.status === "blocked") confidenceScore -= 30;
  if (input.review.pendingCount > 0) confidenceScore -= 10;
  if (input.review.rejectedCount > 0) confidenceScore -= 25;
  if (staleDanger) confidenceScore -= 8;
  if (prRecoveryDanger) confidenceScore -= 6;
  if (releaseDanger) confidenceScore -= 8;

  confidenceScore = Math.max(0, Math.min(100, confidenceScore));
  const confidenceLevel =
    confidenceScore >= 75 ? "high" : confidenceScore >= 50 ? "medium" : "low";

  if (input.policy.status === "blocked") {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: "blocked",
      escalationReason: "Policy evaluation is blocked, so the run cannot progress normally.",
      humanReviewRequired: true,
      recommendedNextAction: "Resolve the policy blockers before continuing.",
    };
  }

  if (input.review.rejectedCount > 0 || input.release.latestSignoffDecision === "rejected") {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: "blocked",
      escalationReason: "A required review or release sign-off was rejected.",
      humanReviewRequired: true,
      recommendedNextAction: "Resolve the rejected review or sign-off before continuing.",
    };
  }

  const hardGateBlocked =
    input.hardGates.mergeStatus === "blocked" ||
    input.hardGates.deploymentApprovalStatus === "blocked" ||
    input.hardGates.deploymentExecutionStatus === "blocked" ||
    input.hardGates.signoffCompletedStatus === "blocked" ||
    input.hardGates.signoffExceptionsStatus === "blocked";
  if (hardGateBlocked && (criticalDanger || input.riskClassification.riskLevel === "critical")) {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: "blocked",
      escalationReason: "A hard release gate is blocked in a critical-risk context.",
      humanReviewRequired: true,
      recommendedNextAction: "Resolve the release blocker before any further release actions.",
    };
  }

  if (criticalDanger || input.riskClassification.riskLevel === "critical") {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: hardGateBlocked ? "blocked" : "senior_approval",
      escalationReason:
        "Critical protected-domain or governance danger points were detected, so routine handling is not appropriate.",
      humanReviewRequired: true,
      recommendedNextAction: hardGateBlocked
        ? "Resolve the blocking governance issue before continuing."
        : "Escalate to senior approval before continuing.",
    };
  }

  if (input.qualityGates.failedCount > 0) {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: input.riskClassification.riskLevel === "high" ? "required_review_stage" : "operator_review",
      escalationReason:
        "Quality gates failed, so the run still needs focused human review even if the changed-file risk is otherwise understood.",
      humanReviewRequired: true,
      recommendedNextAction: "Review the failing quality gate output and decide whether a focused fix is needed.",
    };
  }

  if (input.riskClassification.riskLevel === "high") {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel:
        input.review.requiredCount > 0 && input.review.pendingCount > 0
          ? "required_review_stage"
          : "senior_approval",
      escalationReason:
        "High-risk domains are in scope, so human review remains mandatory even when tests pass.",
      humanReviewRequired: true,
      recommendedNextAction:
        input.review.requiredCount > 0 && input.review.pendingCount > 0
          ? "Complete the required review stages before continuing."
          : "Escalate for senior approval before continuing.",
    };
  }

  if (
    input.policy.status === "requires_review" ||
    input.replay.status === "warning" ||
    input.release.checklistStatus === "blocked" ||
    input.release.checklistStatus === "needs_attention" ||
    hardGateBlocked
  ) {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel:
        input.review.requiredCount > 0 && input.review.pendingCount > 0
          ? "required_review_stage"
          : "operator_review",
      escalationReason:
        "Governance or release signals still need interpretation even though the underlying change risk may be understood.",
      humanReviewRequired: true,
      recommendedNextAction:
        input.review.requiredCount > 0 && input.review.pendingCount > 0
          ? "Complete the required review stages before continuing."
          : "Review the warnings and confirm the next governed step.",
    };
  }

  if (input.riskClassification.riskLevel === "medium") {
    return {
      confidenceLevel,
      confidenceScore,
      escalationLevel: "operator_review",
      escalationReason:
        "The run changes executable application behavior, so operator review is still appropriate before later release steps.",
      humanReviewRequired: true,
      recommendedNextAction: "Review the danger points and confirm the next governed step.",
    };
  }

  return {
    confidenceLevel,
    confidenceScore,
    escalationLevel: "none",
    escalationReason:
      "The run is low-risk, quality gates passed, and there are no unresolved policy or replay warnings requiring extra escalation.",
    humanReviewRequired: false,
    recommendedNextAction: "Continue through the existing manual workflow with the usual governed checkpoints.",
  };
}
