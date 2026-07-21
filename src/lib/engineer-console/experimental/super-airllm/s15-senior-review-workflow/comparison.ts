/** Content hashing and deterministic comparison for S15. */

import { createHash } from "crypto";
import type { ComparisonRecord, DefaultReviewRecord, SeniorReviewRecord } from "./types";

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function findingLines(content: string): string[] {
  return normalizeLines(content).filter(
    (l) =>
      /^(finding|issue|risk|recommend|action|severity|blocker|note)\b/i.test(l) ||
      l.startsWith("- ") ||
      l.startsWith("* "),
  );
}

/**
 * Rule-based dual-review comparison. Never auto-selects a winner.
 * Does not invoke any model and cannot accept the senior result.
 */
export function compareReviews(
  defaultReview: DefaultReviewRecord,
  seniorReview: SeniorReviewRecord,
): ComparisonRecord {
  const defaultLines = new Set(normalizeLines(defaultReview.content));
  const seniorLines = new Set(normalizeLines(seniorReview.content));
  const defaultFindings = findingLines(defaultReview.content);
  const seniorFindings = findingLines(seniorReview.content);

  const agreements: string[] = [];
  for (const line of defaultLines) {
    if (seniorLines.has(line)) agreements.push(line);
  }

  const disagreements: string[] = [];
  for (const line of defaultLines) {
    if (!seniorLines.has(line)) disagreements.push(`default_only_line:${line}`);
  }
  for (const line of seniorLines) {
    if (!defaultLines.has(line)) disagreements.push(`senior_only_line:${line}`);
  }

  const defaultFindingSet = new Set(defaultFindings);
  const seniorFindingSet = new Set(seniorFindings);
  const seniorOnlyFindings = seniorFindings.filter((f) => !defaultFindingSet.has(f));
  const defaultOnlyFindings = defaultFindings.filter((f) => !seniorFindingSet.has(f));

  const severityDifferences: string[] = [];
  const recommendationDifferences: string[] = [];
  const proposedActions: string[] = [];
  for (const line of [...defaultLines, ...seniorLines]) {
    if (/severity|critical|blocker/i.test(line) && !agreements.includes(line)) {
      severityDifferences.push(line);
    }
    if (/recommend/i.test(line) && !agreements.includes(line)) {
      recommendationDifferences.push(line);
    }
    if (/^(action|apply|commit|merge|deploy)\b/i.test(line) || /\bpatch\b/i.test(line)) {
      proposedActions.push(line);
    }
  }

  const confidenceNotes = [
    "comparison_runtime:rule_based_s15_v1",
    "auto_selected_winner:false",
    "comparison_cannot_accept_senior:true",
    `default_content_sha256:${defaultReview.contentSha256}`,
    `senior_content_sha256:${seniorReview.contentSha256}`,
  ];

  const comparisonId = newId("s15-cmp");
  const body = {
    comparisonId,
    agreements: [...agreements].sort(),
    disagreements: [...disagreements].sort(),
    seniorOnlyFindings: [...seniorOnlyFindings].sort(),
    defaultOnlyFindings: [...defaultOnlyFindings].sort(),
    severityDifferences: [...new Set(severityDifferences)].sort(),
    recommendationDifferences: [...new Set(recommendationDifferences)].sort(),
    confidenceNotes,
    proposedActions: [...new Set(proposedActions)].sort(),
    autoSelectedWinner: false as const,
    comparisonRuntime: "rule_based_s15_v1" as const,
  };
  const comparisonSha256 = sha256Text(JSON.stringify(body));
  return {
    ...body,
    comparisonSha256,
    createdAt: utcNow(),
  };
}
