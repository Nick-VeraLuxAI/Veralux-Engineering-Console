/** Structured PR-readiness recommendation extraction — never auto-maps free-form sentiment. */

import type { PrReadinessRecommendation } from "./types";

const VALID: ReadonlySet<string> = new Set(["ready", "not_ready", "needs_revision", "neutral"]);

/**
 * Accept only an explicit validated format.
 * Preferred forms:
 *   recommendation: ready|not_ready|needs_revision|neutral
 *   RECOMMENDATION=ready|...
 * Invalid / ambiguous → neutral. Raw text is always preserved separately.
 */
export function extractRecommendation(
  raw: string | undefined | null,
): PrReadinessRecommendation {
  if (!raw || !raw.trim()) return "neutral";
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /^\s*recommendation\s*[:=]\s*(ready|not_ready|needs_revision|neutral)\s*$/i,
    );
    if (m) {
      const value = m[1].toLowerCase();
      if (VALID.has(value)) return value as PrReadinessRecommendation;
    }
  }
  const trimmed = raw.trim();
  const single = trimmed.match(
    /^recommendation\s*[:=]\s*(ready|not_ready|needs_revision|neutral)$/i,
  );
  if (single && VALID.has(single[1].toLowerCase())) {
    return single[1].toLowerCase() as PrReadinessRecommendation;
  }
  return "neutral";
}

export function buildDefaultReviewContent(input: {
  prPreparationSha256: string;
  qualityReportSha256?: string;
  branchName?: string;
  commitSha?: string;
  proposedFileCount?: number;
  validationResults?: Array<{ checkId: string; ok: boolean; message: string }>;
  schemaVersion: string;
}): string {
  const checks = (input.validationResults ?? [])
    .map((c) => `- ${c.checkId}: ${c.ok ? "ok" : "failed"} — ${c.message}`)
    .join("\n");
  const allOk =
    (input.validationResults ?? []).length > 0 &&
    (input.validationResults ?? []).every((c) => c.ok);
  return [
    "source: deterministic_pr_readiness_summary",
    `schema: ${input.schemaVersion}`,
    `pr_preparation_sha256: ${input.prPreparationSha256}`,
    `quality_report_sha256: ${input.qualityReportSha256 ?? "(none)"}`,
    `branch: ${input.branchName ?? "(none)"}`,
    `commit: ${input.commitSha ?? "(none)"}`,
    `proposed_file_count: ${input.proposedFileCount ?? 0}`,
    "validation:",
    checks || "- (none)",
    `recommendation: ${allOk ? "ready" : "neutral"}`,
    "note: This is the default review product for the Phase 2X PR-readiness gate.",
    "note: It does not mark ready or create a PR; a human operator must decide.",
  ].join("\n");
}
