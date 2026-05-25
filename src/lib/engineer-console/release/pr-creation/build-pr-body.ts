import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getCompatibilitySummaryForRepo } from "../../repo-intelligence/compatibility/compatibility-manager";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport } from "../../types";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";

export interface BuildPrBodyInput {
  runId: string;
  rationale?: string | null;
}

export function buildPrBody(input: BuildPrBodyInput): string {
  const run = getRunById(input.runId);
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }
  const task = getTaskById(run.taskId);
  const evidence = getEvidenceBundleForRun(input.runId);
  const policy = getLatestPolicyEvaluationResult(input.runId);
  const replay = getLatestReplayVerificationResult(input.runId);
  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(input.runId));
  const gates = getQualityGateResultsForRun(input.runId);
  const compatibility = task?.registeredRepoId
    ? getCompatibilitySummaryForRepo(task.registeredRepoId)
    : null;

  const reportJson = getApprovalReportJson(input.runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const lines: string[] = [
    "## VeraLux Engineering Console",
    "",
    "This pull request was created through the Engineering Console after human approval and governance gates.",
    "",
    "### Task",
    `- **Title:** ${task?.title ?? "—"}`,
    `- **Run ID:** \`${input.runId}\``,
    `- **Branch:** \`${run.branchName ?? "—"}\``,
    "",
    "### Governance summary",
    `- **Evidence bundle hash:** \`${evidence?.bundleHash.slice(0, 12) ?? "—"}\``,
    `- **Policy status:** ${policy?.status ?? "—"} (${policy?.policyVersion ?? "—"}, hash \`${policy?.policyHash.slice(0, 12) ?? "—"}\`)`,
    `- **Replay verification:** ${replay?.status ?? "not run"}`,
    `- **Review stages:** ${reviewSummary.approvedCount}/${reviewSummary.requiredCount} required approved (${reviewSummary.pendingCount} pending, ${reviewSummary.rejectedCount} rejected)`,
    `- **Changed files:** ${approvalReport?.changedFiles.length ?? 0}`,
    "",
    "### Quality gates",
  ];

  if (gates.length === 0) {
    lines.push("- No quality gate results recorded.");
  } else {
    for (const gate of gates.slice(0, 10)) {
      lines.push(`- \`${gate.command}\`: **${gate.status}** (exit ${gate.exitCode})`);
    }
  }

  if (compatibility && (compatibility.linkCount > 0 || compatibility.latestRunAt)) {
    lines.push("", "### Compatibility");
    lines.push(
      `- Breaking: ${compatibility.breakingCount}, warnings: ${compatibility.warningCount}, links: ${compatibility.linkCount}`,
    );
  }

  if (input.rationale?.trim()) {
    lines.push("", "### Operator rationale", input.rationale.trim().slice(0, 1000));
  }

  lines.push(
    "",
    "---",
    "**Merge and deploy remain human-controlled.** This PR was opened as a draft by default; no auto-merge or deployment was performed.",
  );

  return lines.join("\n");
}

/** Test helper: ensure body excludes sensitive content patterns. */
export function prBodyExcludesSensitiveContent(body: string): boolean {
  const forbidden = [/OPENAI_API_KEY/i, /ghp_[a-zA-Z0-9]+/, /rawResponse/i, /promptHash/i];
  return !forbidden.some((p) => p.test(body));
}
