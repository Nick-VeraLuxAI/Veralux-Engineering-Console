import { redactDeploymentOutput } from "../deployment-execution/redact-deployment-output";
import type { DeploymentHealthPolicyEvaluation } from "./deployment-health-policy-types";

/** Allowlisted, redacted snapshot for DB/audit/API storage — no response bodies or profile URLs. */
export function toStorableDeploymentHealthPolicyEvaluation(
  evaluation: DeploymentHealthPolicyEvaluation,
): DeploymentHealthPolicyEvaluation {
  return {
    runId: evaluation.runId,
    status: evaluation.status,
    policyVersion: evaluation.policyVersion,
    policyHash: evaluation.policyHash,
    evaluatedAt: evaluation.evaluatedAt,
    deploymentExecutionId: evaluation.deploymentExecutionId,
    healthCheckId: evaluation.healthCheckId,
    environmentName: evaluation.environmentName,
    healthProfile: evaluation.healthProfile,
    healthCheckStatus: evaluation.healthCheckStatus,
    responseStatus: evaluation.responseStatus,
    responseTimeMs: evaluation.responseTimeMs,
    warnings: evaluation.warnings.map((w) => redactDeploymentOutput(w)),
    blockers: evaluation.blockers.map((b) => redactDeploymentOutput(b)),
    recommendedAction: redactDeploymentOutput(evaluation.recommendedAction),
  };
}
