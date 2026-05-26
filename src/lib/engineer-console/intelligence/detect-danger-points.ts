import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import { RUN_PANEL_IDS, type RunWorkflowSummary } from "@/lib/engineer-console/run-ux/run-ux-types";
import type { PolicyEvaluationResult } from "@/lib/engineer-console/governance/policy-results/policy-types";
import type { ReplayVerificationResult } from "@/lib/engineer-console/governance/replay-verification/replay-verification-types";
import type { PrReadinessResult } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
import type { DangerPoint } from "./danger-point-types";
import {
  classifyPathDomains,
  inferTaskIntent,
  maxSeverityForDomains,
  normalizeIntelligencePath,
  tokenizeForComparison,
} from "./path-risk-rules";

export interface ParsedWorkerPlanSnapshot {
  summary: string;
  allowedFiles: string[];
  operations: Array<{
    type: string;
    path: string;
    reason: string;
  }>;
  validationStatus: string | null;
  validationErrors: Array<{ code: string; message: string; path?: string }>;
  validationWarnings: Array<{ code: string; message: string; path?: string }>;
  executionStatus: string | null;
}

export interface DetectDangerPointsInput {
  run: EngineeringRun;
  task: EngineeringTask;
  changedFiles: string[];
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
  uxSummary: RunWorkflowSummary;
  latestWorkerPlan: ParsedWorkerPlanSnapshot | null;
  latestWorkerPlanDraft: ParsedWorkerPlanSnapshot | null;
  latestPolicyResult: PolicyEvaluationResult | null;
  latestReplayResult: ReplayVerificationResult | null;
  latestPrReadiness: PrReadinessResult | null;
  latestDecisionAt: string | null;
}

function buildDangerPoint(input: DangerPoint): DangerPoint {
  return input;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function planPaths(snapshot: ParsedWorkerPlanSnapshot | null): string[] {
  if (!snapshot) return [];
  return uniqueStrings([
    ...snapshot.allowedFiles,
    ...snapshot.operations.map((operation) => operation.path),
  ]).map(normalizeIntelligencePath);
}

function pathMatchesIntent(paths: string[], intent: ReturnType<typeof inferTaskIntent>["intents"] extends Set<infer T> ? T : never): boolean {
  if (paths.length === 0) return false;
  return paths.some((path) => {
    const domains = classifyPathDomains(path);
    switch (intent) {
      case "docs":
        return domains.has("docs");
      case "tests":
        return domains.has("tests");
      case "ui":
        return domains.has("ui");
      case "release":
        return domains.has("governance_release") || domains.has("deployment_env");
      case "deployment":
        return domains.has("deployment_env") || domains.has("staging_only");
      case "auth":
        return domains.has("auth_security");
      case "billing":
        return domains.has("billing_pricing");
      case "database":
        return domains.has("database_migration");
      case "staging":
        return domains.has("staging_only");
    }
  });
}

function detectIntentMismatch(
  task: EngineeringTask,
  workerPlan: ParsedWorkerPlanSnapshot | null,
  changedFiles: string[],
): DangerPoint[] {
  const taskIntent = inferTaskIntent(task.title, task.description);
  const paths = uniqueStrings([...planPaths(workerPlan), ...changedFiles]).map(normalizeIntelligencePath);
  const dangerPoints: DangerPoint[] = [];

  if (!workerPlan) {
    return dangerPoints;
  }

  const explicitPathMismatch =
    taskIntent.explicitPaths.length > 0 &&
    taskIntent.explicitPaths.every(
      (expectedPath) =>
        !paths.some((path) => path.endsWith(expectedPath) || expectedPath.endsWith(path)),
    );

  if (explicitPathMismatch) {
    dangerPoints.push(
      buildDangerPoint({
        id: "task-path-mismatch",
        category: "intent_interpretation",
        severity: "high",
        title: "Worker plan may not match the task target",
        explanation:
          "The task references a specific file or path, but the worker plan and current change scope do not include it.",
        evidence: [
          `Task references: ${taskIntent.explicitPaths.join(", ")}`,
          `Plan scope: ${paths.join(", ") || "none"}`,
        ],
        recommendedAction: "Review the worker plan summary and paths before approving or retrying work.",
        anchorTarget: RUN_PANEL_IDS.workerPlan,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  const intentMismatches = Array.from(taskIntent.intents).filter((intent) => !pathMatchesIntent(paths, intent));
  if (intentMismatches.length > 0) {
    const severeIntent = intentMismatches.some((intent) => ["auth", "billing", "database", "deployment"].includes(intent));
    dangerPoints.push(
      buildDangerPoint({
        id: "task-intent-mismatch",
        category: "intent_interpretation",
        severity: severeIntent ? "high" : "medium",
        title: "Worker plan intent may not match the requested task",
        explanation:
          "The task language suggests a narrower or different change type than the files currently targeted by the worker plan or change set.",
        evidence: [
          `Detected task intents: ${Array.from(taskIntent.intents).join(", ")}`,
          `Plan summary: ${workerPlan.summary}`,
          `Plan paths: ${paths.join(", ") || "none"}`,
        ],
        recommendedAction: "Confirm that the worker plan summary and affected files match the actual task before proceeding.",
        anchorTarget: RUN_PANEL_IDS.workerPlan,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  } else {
    const taskTokens = tokenizeForComparison(`${task.title} ${task.description}`);
    const planTokens = tokenizeForComparison(workerPlan.summary);
    const overlap = Array.from(taskTokens).filter((token) => planTokens.has(token)).length;
    const overlapRatio = taskTokens.size > 0 ? overlap / taskTokens.size : 1;
    if (taskTokens.size >= 3 && planTokens.size >= 2 && overlapRatio < 0.2) {
      dangerPoints.push(
        buildDangerPoint({
          id: "task-summary-low-overlap",
          category: "intent_interpretation",
          severity: "low",
          title: "Worker plan summary has weak overlap with task language",
          explanation:
            "The plan summary uses meaningfully different language from the task, which may indicate a mismatch or an under-explained plan.",
          evidence: [
            `Task summary: ${task.title}`,
            `Plan summary: ${workerPlan.summary}`,
          ],
          recommendedAction: "Review the plan summary and changed files to confirm the plan still matches the requested work.",
          anchorTarget: RUN_PANEL_IDS.workerPlan,
          humanReviewRequired: true,
          futurePlaybookPossible: false,
        }),
      );
    }
  }

  return dangerPoints;
}

function detectUnexpectedScope(
  task: EngineeringTask,
  workerPlan: ParsedWorkerPlanSnapshot | null,
  changedFiles: string[],
): DangerPoint[] {
  if (!workerPlan || changedFiles.length === 0) return [];
  const allowed = new Set(workerPlan.allowedFiles.map(normalizeIntelligencePath));
  const unexpectedFiles = changedFiles
    .map(normalizeIntelligencePath)
    .filter((file) => allowed.size > 0 && !allowed.has(file));
  const taskIntent = inferTaskIntent(task.title, task.description);
  const wrongDomainFiles = changedFiles
    .map(normalizeIntelligencePath)
    .filter((file) => {
      const domains = classifyPathDomains(file);
      if (taskIntent.intents.has("docs")) return !domains.has("docs");
      if (taskIntent.intents.has("tests")) return !domains.has("tests");
      if (taskIntent.intents.has("ui")) return !domains.has("ui");
      return false;
    });

  const evidence = uniqueStrings([
    unexpectedFiles.length > 0 ? `Outside allowlist: ${unexpectedFiles.join(", ")}` : null,
    wrongDomainFiles.length > 0 ? `Outside expected task domain: ${wrongDomainFiles.join(", ")}` : null,
  ]);

  if (evidence.length === 0) return [];

  return [
    buildDangerPoint({
      id: "unexpected-change-scope",
      category: "worker_plan_scope",
      severity: wrongDomainFiles.length > 0 ? "high" : "medium",
      title: "Change scope includes unexpected files",
      explanation:
        "The detected change set includes files outside the expected worker-plan scope or outside the task's apparent domain.",
      evidence,
      recommendedAction: "Compare the changed-file list to the task and worker-plan scope before approval or PR creation.",
      anchorTarget: RUN_PANEL_IDS.changedFiles,
      humanReviewRequired: true,
      futurePlaybookPossible: false,
    }),
  ];
}

function detectProtectedAndDomainRisk(changedFiles: string[], approvalReport: ApprovalReport | null): DangerPoint[] {
  const dangerPoints: DangerPoint[] = [];
  const normalized = changedFiles.map(normalizeIntelligencePath);
  const governanceIssues = approvalReport?.governanceIssues ?? [];
  const protectedIssues = governanceIssues.filter(
    (issue) => issue.includes("protected path") || issue.includes("Blocked change"),
  );
  if (protectedIssues.length > 0) {
    dangerPoints.push(
      buildDangerPoint({
        id: "protected-path-touched",
        category: "protected_domain",
        severity: protectedIssues.some((issue) => issue.includes("Blocked change")) ? "critical" : "high",
        title: "Protected path or governed file was touched",
        explanation:
          "The run modified a path that is already governed as protected or elevated-risk by the existing worker-plan or governance rules.",
        evidence: protectedIssues,
        recommendedAction: "Resolve the protected-path issue before proceeding. Do not treat this as a routine warning.",
        anchorTarget: RUN_PANEL_IDS.workerPlan,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  const domainDangerRules: Array<{
    id: string;
    domain: ReturnType<typeof classifyPathDomains> extends Set<infer T> ? T : never;
    title: string;
    explanation: string;
  }> = [
    {
      id: "auth-security-paths",
      domain: "auth_security",
      title: "Auth, security, or session code is in scope",
      explanation: "Changes touch authentication, authorization, security, or session-management code.",
    },
    {
      id: "billing-pricing-paths",
      domain: "billing_pricing",
      title: "Billing or pricing code is in scope",
      explanation: "Changes touch billing, pricing, subscription, or payment-adjacent logic.",
    },
    {
      id: "database-migration-paths",
      domain: "database_migration",
      title: "Database schema or migration code is in scope",
      explanation: "Changes touch database schema, SQL, migrations, or related data-layer structure.",
    },
    {
      id: "deployment-env-paths",
      domain: "deployment_env",
      title: "Deployment, environment, or runtime-config code is in scope",
      explanation: "Changes touch deployment execution, environment handling, or runtime configuration paths.",
    },
    {
      id: "governance-release-paths",
      domain: "governance_release",
      title: "Governance or release-control code is in scope",
      explanation: "Changes touch audit, policy, approval, review, or release-gate logic.",
    },
  ];

  for (const rule of domainDangerRules) {
    const matching = normalized.filter((path) => classifyPathDomains(path).has(rule.domain));
    if (matching.length === 0) continue;
    const domains = matching.flatMap((path) => Array.from(classifyPathDomains(path)));
    const severity = maxSeverityForDomains(domains);
    dangerPoints.push(
      buildDangerPoint({
        id: rule.id,
        category: "protected_domain",
        severity: severity === "critical" ? "critical" : "high",
        title: rule.title,
        explanation: rule.explanation,
        evidence: matching.slice(0, 8),
        recommendedAction: "Use human review and rationale before treating this run as routine.",
        anchorTarget: RUN_PANEL_IDS.changedFiles,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  const criticalDomains = ["tenant_isolation", "credential_handling", "payment_execution", "permission_escalation", "production_data"] as const;
  for (const domain of criticalDomains) {
    const matching = normalized.filter((path) => classifyPathDomains(path).has(domain));
    if (matching.length === 0) continue;
    dangerPoints.push(
      buildDangerPoint({
        id: `critical-${domain}`,
        category: "protected_domain",
        severity: "critical",
        title: "Critical protected domain is in scope",
        explanation:
          "The run touches a domain that should never be treated as routine or auto-handled in future autonomy modes.",
        evidence: matching.slice(0, 8),
        recommendedAction: "Escalate for senior human review. Do not reduce governance based on confidence or history alone.",
        anchorTarget: RUN_PANEL_IDS.changedFiles,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  return dangerPoints;
}

function detectVerificationDangerPoints(
  qualityGates: QualityGateResult[],
  replay: ReplayVerificationResult | null,
  policy: PolicyEvaluationResult | null,
  workerPlan: ParsedWorkerPlanSnapshot | null,
): DangerPoint[] {
  const dangerPoints: DangerPoint[] = [];

  const failedGates = qualityGates.filter((gate) => gate.status === "failed");
  if (failedGates.length > 0) {
    dangerPoints.push(
      buildDangerPoint({
        id: "quality-gates-failed",
        category: "verification",
        severity: failedGates.length > 1 ? "high" : "medium",
        title: "Quality gates failed",
        explanation:
          "One or more build, test, lint, or typecheck commands failed after the worker plan executed.",
        evidence: failedGates.map((gate) => `${gate.command} (exit ${gate.exitCode})`),
        recommendedAction: "Review the failing quality gate output before proceeding.",
        anchorTarget: RUN_PANEL_IDS.qualityGates,
        humanReviewRequired: true,
        futurePlaybookPossible: true,
      }),
    );
  }

  if (workerPlan) {
    const fileIndexWarnings = workerPlan.validationWarnings.filter((warning) => warning.code === "FILE_NOT_IN_INDEX");
    if (fileIndexWarnings.length > 0 || (policy?.signals.unindexedModifiedCount ?? 0) > 0) {
      dangerPoints.push(
        buildDangerPoint({
          id: "file-index-stale",
          category: "verification",
          severity: "medium",
          title: "File index may be stale for this change set",
          explanation:
            "The worker plan or policy results indicate files were changed or referenced outside the latest repository index snapshot.",
          evidence: uniqueStrings([
            ...fileIndexWarnings.map((warning) => warning.path ?? warning.message),
            policy?.signals.unindexedModifiedCount
              ? `${policy.signals.unindexedModifiedCount} changed file(s) were not present in the latest file index`
              : null,
          ]),
          recommendedAction: "Re-index the repository before relying on file-index-based context or approvals.",
          anchorTarget: RUN_PANEL_IDS.workerPlan,
          humanReviewRequired: true,
          futurePlaybookPossible: true,
        }),
      );
    }
  }

  if (replay?.status === "warning" || replay?.status === "failed") {
    dangerPoints.push(
      buildDangerPoint({
        id: "replay-warning-or-failure",
        category: replay.status === "failed" ? "audit_integrity" : "verification",
        severity: replay.status === "failed" ? "high" : "medium",
        title: replay.status === "failed" ? "Replay verification failed" : "Replay verification reported warnings",
        explanation:
          replay.status === "failed"
            ? "The replay verification checks did not fully reconcile the recorded evidence, decisions, or audit chain."
            : "Replay verification completed, but one or more checks still need human interpretation.",
        evidence: replay.checks
          .filter((check) => check.status !== "passed")
          .slice(0, 6)
          .map((check) => check.message),
        recommendedAction: "Review replay verification details before treating the run as routine.",
        anchorTarget: RUN_PANEL_IDS.replay,
        humanReviewRequired: true,
        futurePlaybookPossible: replay.status === "warning",
      }),
    );
  }

  if (policy?.status === "blocked" || policy?.status === "requires_review") {
    dangerPoints.push(
      buildDangerPoint({
        id: "policy-review-required",
        category: "policy_review",
        severity: policy.status === "blocked" ? "critical" : "high",
        title: policy.status === "blocked" ? "Policy evaluation is blocked" : "Policy evaluation requires review",
        explanation:
          policy.status === "blocked"
            ? "Deterministic governance policy found blockers that prevent normal approval or release progression."
            : "Policy evaluation requires human review before the run should be treated as routine.",
        evidence: uniqueStrings([
          ...(policy.blockers ?? []),
          ...(policy.reviewRequired ?? []),
        ]).slice(0, 6),
        recommendedAction:
          policy.recommendedNextAction || "Review policy results before continuing the governed workflow.",
        anchorTarget: RUN_PANEL_IDS.policy,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  return dangerPoints;
}

function detectReviewApprovalAndReleaseDangerPoints(
  input: DetectDangerPointsInput,
): DangerPoint[] {
  const { uxSummary, latestPrReadiness, latestReplayResult, latestPolicyResult } = input;
  const dangerPoints: DangerPoint[] = [];

  if (uxSummary.audit.chainOk === false || uxSummary.audit.chainFailureCount > 0) {
    dangerPoints.push(
      buildDangerPoint({
        id: "audit-chain-warning",
        category: "audit_integrity",
        severity: "critical",
        title: "Audit chain integrity needs attention",
        explanation:
          "The recorded audit chain does not verify cleanly, which makes downstream release judgments materially riskier.",
        evidence: uxSummary.audit.chainFailures.slice(0, 6),
        recommendedAction: "Investigate audit-chain verification before treating this run as releasable.",
        anchorTarget: RUN_PANEL_IDS.auditTimeline,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (uxSummary.review.pendingCount > 0 || uxSummary.review.rejectedCount > 0) {
    dangerPoints.push(
      buildDangerPoint({
        id: "review-stages-unresolved",
        category: "policy_review",
        severity: uxSummary.review.rejectedCount > 0 ? "critical" : "high",
        title:
          uxSummary.review.rejectedCount > 0
            ? "Required review stages were rejected"
            : "Required review stages are still pending",
        explanation:
          "The run still has unresolved review-stage work, so it should not be treated as a routine low-risk approval.",
        evidence: [
          `${uxSummary.review.pendingCount} pending`,
          `${uxSummary.review.rejectedCount} rejected`,
          `${uxSummary.review.approvedCount} approved`,
        ],
        recommendedAction: "Resolve the required review stages before continuing.",
        anchorTarget: RUN_PANEL_IDS.reviewStages,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  const approvalMissing =
    uxSummary.workerPlan.executionStatus === "executed" &&
    uxSummary.approval.latestDecision !== "approved" &&
    uxSummary.run.status !== "completed";
  if (approvalMissing) {
    dangerPoints.push(
      buildDangerPoint({
        id: "approval-missing",
        category: "policy_review",
        severity: "medium",
        title: "Human approval is still missing",
        explanation:
          "The worker plan has executed, but there is no recorded approved decision for this run yet.",
        evidence: [
          `Run status: ${uxSummary.run.status}`,
          `Latest decision: ${uxSummary.approval.latestDecision ?? "none"}`,
        ],
        recommendedAction: "Use the approval report and approval actions to take an explicit human decision.",
        anchorTarget: RUN_PANEL_IDS.approval,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (latestPrReadiness) {
    const prSignals = latestPrReadiness.signals;
    const partialFailure =
      uxSummary.pr.latestStatus === "failed" ||
      prSignals?.canResume ||
      prSignals?.manualRecoveryRequired;
    if (partialFailure) {
      dangerPoints.push(
        buildDangerPoint({
          id: "pr-retry-state",
          category: "pr_recovery",
          severity: prSignals?.manualRecoveryRequired ? "high" : "medium",
          title:
            prSignals?.manualRecoveryRequired
              ? "PR recovery needs manual intervention"
              : "PR creation is in a resumable retry state",
          explanation:
            prSignals?.manualRecoveryRequired
              ? "The PR flow detected inconsistent branch or commit state that should be recovered manually."
              : "The PR flow already detected resumable state, so this run should be treated as a recovery workflow rather than a fresh PR creation.",
          evidence: uniqueStrings([
            uxSummary.pr.latestErrorMessage,
            prSignals?.resumeReason,
            prSignals?.manualRecoveryReason,
          ]),
          recommendedAction: latestPrReadiness.recommendedAction,
          anchorTarget: RUN_PANEL_IDS.prCreation,
          humanReviewRequired: true,
          futurePlaybookPossible: true,
        }),
      );
    }

    if (prSignals?.currentBranchMatchesRunBranch === false) {
      dangerPoints.push(
        buildDangerPoint({
          id: "pr-branch-mismatch",
          category: "pr_recovery",
          severity: "low",
          title: "Current checkout differs from the run branch",
          explanation:
            "PR readiness indicates the current checkout is not on the run branch, which is usually recoverable but should not be ignored.",
          evidence: [
            `Current branch: ${prSignals.currentBranchName ?? "unknown"}`,
            `Run branch: ${prSignals.runBranchName ?? "unknown"}`,
          ],
          recommendedAction: `Checkout ${prSignals.runBranchName ?? "the run branch"} before retrying PR work.`,
          anchorTarget: RUN_PANEL_IDS.prCreation,
          humanReviewRequired: true,
          futurePlaybookPossible: true,
        }),
      );
    }

    if (prSignals?.existingPrUrl || prSignals?.remoteBranchMatchesReusableCommit) {
      dangerPoints.push(
        buildDangerPoint({
          id: "existing-pr-or-commit-state",
          category: "pr_recovery",
          severity: "low",
          title: "Existing PR or reusable commit state was detected",
          explanation:
            "The PR readiness checks found existing branch, commit, or PR state that should be reused instead of recreated.",
          evidence: uniqueStrings([
            prSignals?.existingPrUrl,
            prSignals?.resumeReason,
            prSignals?.remoteBranchMatchesReusableCommit
              ? "Remote branch already matches the reusable run commit"
              : null,
          ]),
          recommendedAction: latestPrReadiness.recommendedAction,
          anchorTarget: RUN_PANEL_IDS.prCreation,
          humanReviewRequired: true,
          futurePlaybookPossible: true,
        }),
      );
    }
  }

  if (uxSummary.hardGates.mergeStatus === "blocked" || uxSummary.merge.latestStatus === "failed") {
    dangerPoints.push(
      buildDangerPoint({
        id: "merge-blocked",
        category: "release_governance",
        severity: "high",
        title: "Merge is currently blocked",
        explanation:
          "The release workflow cannot continue through merge because hard release gates or merge readiness are not satisfied.",
        evidence: uniqueStrings([
          ...uxSummary.hardGates.mergeBlockers,
          uxSummary.merge.latestStatus === "failed" ? "Latest merge attempt failed" : null,
        ]).slice(0, 6),
        recommendedAction: "Review merge controls and upstream release blockers before retrying merge work.",
        anchorTarget: RUN_PANEL_IDS.mergeControls,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (uxSummary.merge.latestStatus === "merged" && uxSummary.deployment.latestApprovalDecision !== "approved") {
    dangerPoints.push(
      buildDangerPoint({
        id: "deployment-approval-missing",
        category: "release_governance",
        severity: uxSummary.deployment.latestApprovalDecision === "rejected" ? "high" : "medium",
        title:
          uxSummary.deployment.latestApprovalDecision === "rejected"
            ? "Deployment approval was rejected"
            : "Deployment approval is still missing",
        explanation:
          "The run has progressed past merge, but the governed deployment approval step has not been satisfied yet.",
        evidence: [
          `Latest deployment approval: ${uxSummary.deployment.latestApprovalDecision ?? "none"}`,
        ],
        recommendedAction: "Evaluate deployment readiness and record the required deployment approval before any execution.",
        anchorTarget: RUN_PANEL_IDS.deploymentGates,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (uxSummary.deployment.latestHealthPolicyStatus === "unhealthy") {
    dangerPoints.push(
      buildDangerPoint({
        id: "deployment-health-unhealthy",
        category: "deployment_health",
        severity: "critical",
        title: "Deployment health policy is unhealthy",
        explanation:
          "Post-deployment health evaluation indicates an unhealthy state, which should block routine release completion decisions.",
        evidence: uniqueStrings([
          ...(uxSummary.deployment.latestHealthPolicyBlockers ?? []),
          latestReplayResult?.status === "failed" ? "Replay verification also failed" : null,
          latestPolicyResult?.status === "blocked" ? "Policy is also blocked" : null,
        ]),
        recommendedAction: uxSummary.deployment.latestHealthPolicyRecommendedAction ||
          "Investigate deployment health before continuing the release path.",
        anchorTarget: RUN_PANEL_IDS.deploymentHealthPolicy,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (uxSummary.release.checklistRecorded && uxSummary.release.checklistStatus !== "complete") {
    dangerPoints.push(
      buildDangerPoint({
        id: "release-checklist-incomplete",
        category: "release_governance",
        severity: uxSummary.release.checklistStatus === "blocked" ? "high" : "medium",
        title: "Release checklist is not complete",
        explanation:
          "The release checklist still has blockers or exceptions, so the release path should not be treated as routine.",
        evidence: uniqueStrings([
          `Checklist status: ${uxSummary.release.checklistStatus ?? "unknown"}`,
          ...uxSummary.release.checklistBlockers,
          ...uxSummary.release.checklistNeedsAttention,
        ]).slice(0, 6),
        recommendedAction: uxSummary.release.checklistRecommendedAction ||
          "Review the release checklist before sign-off or later release actions.",
        anchorTarget: RUN_PANEL_IDS.releaseChecklist,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  if (uxSummary.release.checklistRecorded && !uxSummary.release.latestSignoffDecision) {
    dangerPoints.push(
      buildDangerPoint({
        id: "signoff-missing",
        category: "release_governance",
        severity: "medium",
        title: "Release sign-off is still missing",
        explanation:
          "Checklist evaluation exists, but the release still has no recorded final sign-off decision.",
        evidence: [`Checklist status: ${uxSummary.release.checklistStatus ?? "unknown"}`],
        recommendedAction: "Record a release sign-off decision once checklist and health expectations are satisfied.",
        anchorTarget: RUN_PANEL_IDS.releaseSignoff,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  } else if (uxSummary.release.latestSignoffDecision === "rejected") {
    dangerPoints.push(
      buildDangerPoint({
        id: "signoff-rejected",
        category: "release_governance",
        severity: "critical",
        title: "Release sign-off was rejected",
        explanation:
          "A rejected release sign-off is a material governance boundary and should be treated as a blocker.",
        evidence: uniqueStrings([
          uxSummary.release.latestSignoffRationale,
          `Checklist status: ${uxSummary.release.checklistStatus ?? "unknown"}`,
        ]),
        recommendedAction: "Review the sign-off rationale and resolve the underlying release blockers before proceeding.",
        anchorTarget: RUN_PANEL_IDS.releaseSignoff,
        humanReviewRequired: true,
        futurePlaybookPossible: false,
      }),
    );
  }

  return dangerPoints;
}

function detectFreshnessDangerPoints(input: DetectDangerPointsInput): DangerPoint[] {
  const dangerPoints: DangerPoint[] = [];
  const evidenceUpdatedAt = input.uxSummary.evidence.updatedAt ? Date.parse(input.uxSummary.evidence.updatedAt) : NaN;
  const replayCheckedAt = input.latestReplayResult ? Date.parse(input.latestReplayResult.checkedAt) : NaN;
  const policyEvaluatedAt = input.latestPolicyResult ? Date.parse(input.latestPolicyResult.evaluatedAt) : NaN;
  const decisionAt = input.latestDecisionAt ? Date.parse(input.latestDecisionAt) : NaN;
  const evidenceAfterDecision =
    !Number.isNaN(evidenceUpdatedAt) &&
    !Number.isNaN(decisionAt) &&
    evidenceUpdatedAt > decisionAt;
  const replayStale =
    !Number.isNaN(evidenceUpdatedAt) &&
    !Number.isNaN(replayCheckedAt) &&
    replayCheckedAt < evidenceUpdatedAt;
  const policyStale =
    !Number.isNaN(evidenceUpdatedAt) &&
    !Number.isNaN(policyEvaluatedAt) &&
    policyEvaluatedAt < evidenceUpdatedAt;

  if (evidenceAfterDecision || replayStale || policyStale) {
    dangerPoints.push(
      buildDangerPoint({
        id: "stale-governance-signals",
        category: "freshness_staleness",
        severity: replayStale || policyStale ? "medium" : "low",
        title: "Governance evidence may be stale",
        explanation:
          "Evidence, replay, or policy timestamps suggest later state changes occurred after one or more governance evaluations were recorded.",
        evidence: uniqueStrings([
          evidenceAfterDecision ? "Evidence bundle was regenerated after the latest recorded decision" : null,
          replayStale ? "Replay verification is older than the current evidence bundle" : null,
          policyStale ? "Policy evaluation is older than the current evidence bundle" : null,
        ]),
        recommendedAction: "Refresh replay verification or policy evaluation before treating this run as stable.",
        anchorTarget: evidenceAfterDecision ? RUN_PANEL_IDS.evidence : RUN_PANEL_IDS.policy,
        humanReviewRequired: true,
        futurePlaybookPossible: true,
      }),
    );
  }

  return dangerPoints;
}

export function detectDangerPoints(input: DetectDangerPointsInput): DangerPoint[] {
  const effectiveChangedFiles = input.changedFiles.length > 0
    ? input.changedFiles
    : (input.approvalReport?.changedFiles ?? []);
  const effectivePlan = input.latestWorkerPlan ?? input.latestWorkerPlanDraft;

  return [
    ...detectIntentMismatch(input.task, effectivePlan, effectiveChangedFiles),
    ...detectUnexpectedScope(input.task, effectivePlan, effectiveChangedFiles),
    ...detectProtectedAndDomainRisk(effectiveChangedFiles, input.approvalReport),
    ...detectVerificationDangerPoints(
      input.qualityGates,
      input.latestReplayResult,
      input.latestPolicyResult,
      input.latestWorkerPlan,
    ),
    ...detectReviewApprovalAndReleaseDangerPoints({
      ...input,
      changedFiles: effectiveChangedFiles,
    }),
    ...detectFreshnessDangerPoints({
      ...input,
      changedFiles: effectiveChangedFiles,
    }),
  ];
}
