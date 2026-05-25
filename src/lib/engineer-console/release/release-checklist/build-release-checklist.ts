import { verifyAuditChainCheck } from "../../governance/replay-verification/verify-run-consistency";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../../governance/decision-records/decision-record-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import {
  listDeploymentExecutionsForRun,
  summarizeDeploymentExecutionsForRun,
} from "../deployment-execution/deployment-execution-manager";
import { summarizeDeploymentHealthChecksForRun } from "../deployment-health-check/deployment-health-check-manager";
import { getLatestDeploymentHealthPolicyResult } from "../deployment-health-policy/deployment-health-policy-manager";
import { parseDeploymentHealthPolicyEvaluation } from "../deployment-health-policy/deployment-health-policy-manager";
import {
  listDeploymentReadinessChecksForRun,
  summarizeDeploymentGatesForRun,
} from "../deployment-gates/deployment-gate-manager";
import { summarizeMergeRequestsForRun } from "../merge-controls/merge-request-manager";
import { summarizePrRequestsForRun } from "../pr-creation/pr-request-manager";
import type {
  ReleaseChecklistEvaluation,
  ReleaseChecklistItem,
  ReleaseChecklistItemSeverity,
  ReleaseChecklistItemStatus,
  ReleaseChecklistStatus,
} from "./release-checklist-types";

function item(
  id: string,
  label: string,
  status: ReleaseChecklistItemStatus,
  severity: ReleaseChecklistItemSeverity,
  summary: string,
  recommendedAction: string,
  referenceId: string | null = null,
  referenceHash: string | null = null,
): ReleaseChecklistItem {
  return {
    id,
    label,
    status,
    severity,
    summary,
    referenceId,
    referenceHash,
    recommendedAction,
  };
}

function deriveOverallStatus(
  items: ReleaseChecklistItem[],
  lifecycleStarted: boolean,
): ReleaseChecklistStatus {
  if (!lifecycleStarted) {
    const actionable = items.filter((i) => i.id !== "audit_integrity");
    if (actionable.every((i) => i.status === "not_started")) {
      return "not_started";
    }
  }

  const criticalBlocked = items.filter(
    (i) => i.status === "blocked" && (i.severity === "critical" || i.severity === "high"),
  );
  if (criticalBlocked.length > 0) {
    return "blocked";
  }

  const healthPolicy = items.find((i) => i.id === "health_policy");
  if (
    healthPolicy?.summary.includes("unhealthy") ||
    healthPolicy?.summary.includes("Production deployment has no recorded")
  ) {
    return "needs_attention";
  }
  if (healthPolicy?.status === "needs_attention") {
    return "needs_attention";
  }

  const anyBlocked = items.some((i) => i.status === "blocked");
  const anyNeedsAttention = items.some((i) => i.status === "needs_attention");

  if (!lifecycleStarted) {
    const hasApproval = items.find((i) => i.id === "human_approval")?.status === "complete";
    const hasEvidence = items.find((i) => i.id === "evidence_bundle")?.status === "complete";
    if (!hasApproval && !hasEvidence) {
      return "not_started";
    }
  }

  if (anyBlocked) {
    return "blocked";
  }

  if (anyNeedsAttention) {
    return "needs_attention";
  }

  const releasePathIds = [
    "human_approval",
    "evidence_bundle",
    "policy_result",
    "review_stages",
    "replay_verification",
    "pr_created",
    "pr_merged",
    "deployment_approved",
    "deployment_executed",
    "deployment_succeeded",
    "health_check",
    "health_policy",
    "audit_integrity",
  ];

  const releaseItems = items.filter((i) => releasePathIds.includes(i.id));
  const allComplete = releaseItems.every((i) => i.status === "complete");
  if (allComplete) {
    return "complete";
  }

  if (!lifecycleStarted) {
    return "not_started";
  }

  return "needs_attention";
}

export function buildReleaseChecklist(runId: string): ReleaseChecklistEvaluation {
  const evaluatedAt = new Date().toISOString();
  const evidence = getEvidenceBundleForRun(runId);
  const decisions = listDecisionRecords(runId);
  const approvedDecision = decisions.find((d) => d.decision === "approved");
  const policy = getLatestPolicyEvaluationResult(runId);
  const replay = getLatestReplayVerificationResult(runId);
  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(runId));
  const prSummary = summarizePrRequestsForRun(runId);
  const mergeSummary = summarizeMergeRequestsForRun(runId);
  const deployGates = summarizeDeploymentGatesForRun(runId);
  const deployExec = summarizeDeploymentExecutionsForRun(runId);
  const executions = listDeploymentExecutionsForRun(runId);
  const latestExecution = executions.find((e) => e.status === "succeeded") ?? executions[0] ?? null;
  const healthChecks = summarizeDeploymentHealthChecksForRun(runId);
  const healthPolicyRecord = getLatestDeploymentHealthPolicyResult(runId);
  const healthPolicyEval = healthPolicyRecord
    ? parseDeploymentHealthPolicyEvaluation(healthPolicyRecord)
    : null;
  const readinessCount = listDeploymentReadinessChecksForRun(runId).length;

  const lifecycleStarted =
    prSummary.attemptCount > 0 ||
    mergeSummary.attemptCount > 0 ||
    readinessCount > 0 ||
    deployExec.executionCount > 0;

  const releaseIntent = lifecycleStarted || Boolean(approvedDecision) || Boolean(policy);

  const items: ReleaseChecklistItem[] = [];

  items.push(
    approvedDecision
      ? item(
          "human_approval",
          "Human approval",
          "complete",
          "critical",
          `Approved by ${approvedDecision.actorLabel ?? "operator"}.`,
          "Human approval is recorded.",
          approvedDecision.id,
          approvedDecision.auditChainHash?.slice(0, 12) ?? null,
        )
      : item(
          "human_approval",
          "Human approval",
          lifecycleStarted ? "blocked" : "not_started",
          "critical",
          "No approved human decision record for this run.",
          "Record an approved human decision before release completion.",
        ),
  );

  items.push(
    evidence
      ? item(
          "evidence_bundle",
          "Evidence bundle",
          "complete",
          "critical",
          "Evidence bundle is present for this run.",
          "Evidence bundle is available.",
          evidence.id,
          evidence.bundleHash.slice(0, 12),
        )
      : item(
          "evidence_bundle",
          "Evidence bundle",
          releaseIntent ? "blocked" : "not_started",
          "critical",
          "No evidence bundle has been generated for this run.",
          "Regenerate the evidence bundle before considering release complete.",
        ),
  );

  if (!policy) {
    items.push(
      item(
        "policy_result",
        "Governance policy",
        lifecycleStarted ? "needs_attention" : "not_started",
        "high",
        "No governance policy evaluation recorded.",
        "Run governance policy evaluation.",
      ),
    );
  } else if (policy.status === "blocked") {
    items.push(
      item(
        "policy_result",
        "Governance policy",
        "blocked",
        "critical",
        `Policy evaluation is blocked (${policy.blockers.length} blocker(s)).`,
        policy.recommendedNextAction,
        null,
        policy.policyHash.slice(0, 12),
      ),
    );
  } else if (policy.status === "requires_review" || policy.status === "warning") {
    items.push(
      item(
        "policy_result",
        "Governance policy",
        "needs_attention",
        "high",
        `Policy evaluation status: ${policy.status}.`,
        policy.recommendedNextAction,
        null,
        policy.policyHash.slice(0, 12),
      ),
    );
  } else {
    items.push(
      item(
        "policy_result",
        "Governance policy",
        "complete",
        "high",
        `Policy evaluation passed (${policy.status}).`,
        policy.recommendedNextAction,
        null,
        policy.policyHash.slice(0, 12),
      ),
    );
  }

  if (reviewSummary.requiredCount === 0) {
    items.push(
      item(
        "review_stages",
        "Review stages",
        "not_started",
        "medium",
        "No required review stages configured.",
        "Reconcile review stages when governance requires them.",
      ),
    );
  } else if (reviewSummary.rejectedCount > 0) {
    items.push(
      item(
        "review_stages",
        "Review stages",
        "blocked",
        "critical",
        `${reviewSummary.rejectedCount} required review stage(s) rejected.`,
        "Resolve rejected review stages before release completion.",
      ),
    );
  } else if (reviewSummary.pendingCount > 0) {
    items.push(
      item(
        "review_stages",
        "Review stages",
        "blocked",
        "critical",
        `${reviewSummary.pendingCount} required review stage(s) still pending.`,
        "Complete pending required review stages.",
      ),
    );
  } else {
    items.push(
      item(
        "review_stages",
        "Review stages",
        "complete",
        "high",
        `All ${reviewSummary.requiredCount} required review stage(s) approved.`,
        "Review stages are satisfied.",
      ),
    );
  }

  if (!replay) {
    items.push(
      item(
        "replay_verification",
        "Replay verification",
        lifecycleStarted ? "needs_attention" : "not_started",
        "high",
        "Replay verification has not been run.",
        "Run replay verification for this run.",
      ),
    );
  } else if (replay.status === "failed") {
    items.push(
      item(
        "replay_verification",
        "Replay verification",
        "blocked",
        "critical",
        "Replay verification failed.",
        "Resolve replay verification failures before release completion.",
      ),
    );
  } else if (replay.status === "warning") {
    items.push(
      item(
        "replay_verification",
        "Replay verification",
        "needs_attention",
        "medium",
        "Replay verification completed with warnings.",
        "Review replay warnings before release completion.",
      ),
    );
  } else {
    items.push(
      item(
        "replay_verification",
        "Replay verification",
        "complete",
        "high",
        "Replay verification passed.",
        "Replay verification is satisfied.",
      ),
    );
  }

  if (prSummary.attemptCount === 0) {
    items.push(
      item(
        "pr_created",
        "PR created",
        "not_started",
        "medium",
        "No pull request creation attempt recorded.",
        "Create a pull request when the branch is ready.",
      ),
    );
  } else if (prSummary.latestStatus === "pr_created") {
    items.push(
      item(
        "pr_created",
        "PR created",
        "complete",
        "medium",
        "Latest PR request succeeded.",
        "Pull request is available.",
      ),
    );
  } else if (prSummary.latestStatus === "failed") {
    items.push(
      item(
        "pr_created",
        "PR created",
        "needs_attention",
        "medium",
        "Latest PR creation attempt failed.",
        "Retry PR creation or verify repository access.",
      ),
    );
  } else {
    items.push(
      item(
        "pr_created",
        "PR created",
        "needs_attention",
        "medium",
        `Latest PR status: ${prSummary.latestStatus ?? "unknown"}.`,
        "Complete PR creation workflow.",
      ),
    );
  }

  if (mergeSummary.attemptCount === 0) {
    items.push(
      item(
        "pr_merged",
        "PR merged",
        prSummary.latestStatus === "pr_created" ? "needs_attention" : "not_started",
        "high",
        "No merge attempt recorded.",
        prSummary.latestStatus === "pr_created"
          ? "Merge the pull request before deployment."
          : "Merge the pull request when ready.",
      ),
    );
  } else if (mergeSummary.latestStatus === "merged") {
    items.push(
      item(
        "pr_merged",
        "PR merged",
        "complete",
        "high",
        "Latest merge request completed successfully.",
        "Pull request is merged.",
        null,
        mergeSummary.latestMergeShaPrefix,
      ),
    );
  } else if (mergeSummary.latestStatus === "failed") {
    items.push(
      item(
        "pr_merged",
        "PR merged",
        "blocked",
        "high",
        "Latest merge attempt failed.",
        "Resolve merge failures before release completion.",
      ),
    );
  } else {
    items.push(
      item(
        "pr_merged",
        "PR merged",
        "needs_attention",
        "high",
        `Latest merge status: ${mergeSummary.latestStatus ?? "in progress"}.`,
        "Complete merge before deployment approval.",
      ),
    );
  }

  if (deployGates.latestApprovalDecision === "approved") {
    items.push(
      item(
        "deployment_approved",
        "Deployment approved",
        "complete",
        "high",
        `Deployment approved for ${deployGates.latestEnvironmentName ?? "target environment"}.`,
        "Deployment approval is recorded.",
      ),
    );
  } else if (deployGates.latestApprovalDecision === "rejected") {
    items.push(
      item(
        "deployment_approved",
        "Deployment approved",
        "blocked",
        "critical",
        "Deployment approval was rejected.",
        "Obtain deployment approval before executing.",
      ),
    );
  } else if (readinessCount > 0) {
    items.push(
      item(
        "deployment_approved",
        "Deployment approved",
        "needs_attention",
        "high",
        "Deployment readiness evaluated but not approved.",
        "Record deployment approval when ready.",
      ),
    );
  } else {
    items.push(
      item(
        "deployment_approved",
        "Deployment approved",
        mergeSummary.latestStatus === "merged" ? "needs_attention" : "not_started",
        "high",
        "No deployment approval recorded.",
        "Evaluate deployment readiness and obtain approval.",
      ),
    );
  }

  if (deployExec.executionCount === 0) {
    const approvedNoExec = deployGates.latestApprovalDecision === "approved";
    items.push(
      item(
        "deployment_executed",
        "Deployment executed",
        approvedNoExec ? "needs_attention" : "not_started",
        "high",
        approvedNoExec
          ? "Deployment is approved but has not been executed."
          : "No deployment execution recorded.",
        approvedNoExec
          ? "Execute deployment for the approved environment."
          : "Execute deployment after approval.",
      ),
    );
  } else {
    items.push(
      item(
        "deployment_executed",
        "Deployment executed",
        "complete",
        "high",
        `${deployExec.executionCount} deployment execution(s) recorded.`,
        "Deployment execution has been attempted.",
        latestExecution?.id ?? null,
        null,
      ),
    );
  }

  if (!latestExecution) {
    items.push(
      item(
        "deployment_succeeded",
        "Deployment succeeded",
        deployExec.executionCount > 0 ? "blocked" : "not_started",
        "critical",
        deployExec.executionCount > 0
          ? "No successful deployment execution."
          : "Deployment has not been executed.",
        deployExec.latestStatus === "failed"
          ? "Investigate failed deployment execution."
          : "Complete a successful deployment execution.",
      ),
    );
  } else if (latestExecution.status === "succeeded") {
    items.push(
      item(
        "deployment_succeeded",
        "Deployment succeeded",
        "complete",
        "critical",
        "Latest deployment execution succeeded.",
        "Deployment execution succeeded.",
        latestExecution.id,
        latestExecution.outputHash?.slice(0, 12) ?? null,
      ),
    );
  } else {
    items.push(
      item(
        "deployment_succeeded",
        "Deployment succeeded",
        "blocked",
        "critical",
        `Latest deployment execution status: ${latestExecution.status}.`,
        "Re-run deployment after resolving failures.",
        latestExecution.id,
      ),
    );
  }

  if (healthChecks.checkCount === 0) {
    items.push(
      item(
        "health_check",
        "Post-deploy health check",
        latestExecution?.status === "succeeded" ? "needs_attention" : "not_started",
        "medium",
        "No post-deploy health check recorded.",
        "Run a post-deploy health check after successful deployment.",
      ),
    );
  } else if (healthChecks.latestStatus === "healthy") {
    items.push(
      item(
        "health_check",
        "Post-deploy health check",
        "complete",
        "medium",
        "Latest health check reported healthy.",
        "Health check is satisfied.",
      ),
    );
  } else if (healthChecks.latestStatus === "unhealthy") {
    items.push(
      item(
        "health_check",
        "Post-deploy health check",
        "needs_attention",
        "high",
        "Latest health check reported unhealthy HTTP response.",
        "Investigate target health and re-run checks.",
      ),
    );
  } else if (healthChecks.latestStatus === "failed") {
    items.push(
      item(
        "health_check",
        "Post-deploy health check",
        "needs_attention",
        "medium",
        "Latest health check failed (timeout or network).",
        "Re-run health check or verify connectivity.",
      ),
    );
  } else {
    items.push(
      item(
        "health_check",
        "Post-deploy health check",
        "needs_attention",
        "medium",
        `Latest health check status: ${healthChecks.latestStatus ?? "incomplete"}.`,
        "Wait for health check completion or run a new check.",
      ),
    );
  }

  if (!healthPolicyRecord) {
    items.push(
      item(
        "health_policy",
        "Deployment health policy",
        latestExecution?.status === "succeeded" ? "needs_attention" : "not_started",
        "high",
        "Deployment health policy has not been evaluated.",
        "Evaluate deployment health policy after deployment or health checks.",
      ),
    );
  } else if (healthPolicyRecord.status === "healthy") {
    items.push(
      item(
        "health_policy",
        "Deployment health policy",
        "complete",
        "high",
        "Deployment health policy is healthy.",
        healthPolicyEval?.recommendedAction ?? "Health policy is satisfied.",
        healthPolicyRecord.id,
        healthPolicyRecord.policyHash.slice(0, 12),
      ),
    );
  } else if (healthPolicyRecord.status === "unhealthy") {
    items.push(
      item(
        "health_policy",
        "Deployment health policy",
        "needs_attention",
        "critical",
        "Deployment health policy reports unhealthy.",
        healthPolicyEval?.recommendedAction ??
          "Investigate deployment health before release completion.",
        healthPolicyRecord.id,
        healthPolicyRecord.policyHash.slice(0, 12),
      ),
    );
  } else if (healthPolicyRecord.status === "needs_attention") {
    const productionNoCheck =
      healthPolicyEval?.environmentName === "production" &&
      healthPolicyEval.warnings.some((w) => w.includes("Production"));
    items.push(
      item(
        "health_policy",
        "Deployment health policy",
        "needs_attention",
        productionNoCheck ? "critical" : "high",
        productionNoCheck
          ? "Production deployment has no recorded post-deploy health check."
          : "Deployment health policy needs attention.",
        healthPolicyEval?.recommendedAction ?? "Review deployment health policy warnings.",
        healthPolicyRecord.id,
        healthPolicyRecord.policyHash.slice(0, 12),
      ),
    );
  } else {
    items.push(
      item(
        "health_policy",
        "Deployment health policy",
        healthPolicyRecord.status === "not_checked" ? "complete" : "needs_attention",
        "medium",
        `Deployment health policy status: ${healthPolicyRecord.status}.`,
        healthPolicyEval?.recommendedAction ?? "Evaluate deployment health policy.",
        healthPolicyRecord.id,
        healthPolicyRecord.policyHash.slice(0, 12),
      ),
    );
  }

  const auditCheck = verifyAuditChainCheck(runId);
  if (auditCheck.status === "failed") {
    items.push(
      item(
        "audit_integrity",
        "Audit chain integrity",
        "blocked",
        "critical",
        auditCheck.message,
        "Investigate audit chain integrity before release completion.",
      ),
    );
  } else if (auditCheck.status === "warning") {
    items.push(
      item(
        "audit_integrity",
        "Audit chain integrity",
        "needs_attention",
        "medium",
        auditCheck.message,
        "Review audit chain warnings.",
      ),
    );
  } else {
    items.push(
      item(
        "audit_integrity",
        "Audit chain integrity",
        "complete",
        "medium",
        auditCheck.message,
        "Audit chain verification passed.",
      ),
    );
  }

  const blockers = items.filter((i) => i.status === "blocked").map((i) => i.summary);
  const needsAttention = items
    .filter((i) => i.status === "needs_attention")
    .map((i) => i.summary);

  const status = deriveOverallStatus(items, lifecycleStarted);

  let recommendedAction =
    "Release checklist is advisory only — resolve blockers before considering release complete.";
  if (status === "complete") {
    recommendedAction =
      "All tracked release lifecycle items are complete. Release may be considered complete (advisory).";
  } else if (status === "not_started") {
    recommendedAction = "Begin the release lifecycle with human approval, evidence, and PR workflow.";
  } else if (status === "needs_attention") {
    recommendedAction = needsAttention[0] ?? "Review items marked needs attention.";
  } else if (blockers.length > 0) {
    recommendedAction = blockers[0] ?? "Resolve blocked checklist items.";
  }

  return {
    runId,
    status,
    evaluatedAt,
    items,
    blockers,
    needsAttention,
    recommendedAction,
    evidenceBundleId: evidence?.id ?? null,
    evidenceBundleHash: evidence?.bundleHash ?? null,
  };
}
