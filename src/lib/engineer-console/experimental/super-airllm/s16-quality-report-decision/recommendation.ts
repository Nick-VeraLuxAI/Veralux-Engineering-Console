/** Structured recommendation extraction — never auto-maps free-form sentiment. */

import type { QualityReportRecommendation } from "./types";

const VALID: ReadonlySet<string> = new Set(["approve", "reject", "needs_revision", "neutral"]);

/**
 * Accept only an explicit validated format.
 * Preferred forms:
 *   recommendation: approve|reject|needs_revision|neutral
 *   RECOMMENDATION=approve|...
 * Invalid / ambiguous → neutral. Raw text is always preserved separately.
 */
export function extractRecommendation(raw: string | undefined | null): QualityReportRecommendation {
  if (!raw || !raw.trim()) return "neutral";
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*recommendation\s*[:=]\s*(approve|reject|needs_revision|neutral)\s*$/i);
    if (m) {
      const value = m[1].toLowerCase();
      if (VALID.has(value)) return value as QualityReportRecommendation;
    }
  }
  // Exact labeled single-line body only (lowercase key required).
  const trimmed = raw.trim();
  const single = trimmed.match(/^recommendation\s*[:=]\s*(approve|reject|needs_revision|neutral)$/i);
  if (single && VALID.has(single[1].toLowerCase())) {
    return single[1].toLowerCase() as QualityReportRecommendation;
  }
  return "neutral";
}

export function recommendationFromQualityReportOverall(
  overallStatus: string | undefined | null,
): QualityReportRecommendation {
  if (overallStatus === "passed") return "approve";
  if (overallStatus === "failed" || overallStatus === "blocked") return "reject";
  return "neutral";
}

export function buildDefaultReviewContent(input: {
  qualityReportSha256: string;
  overallStatus: string;
  gateResults?: Array<{ gateId: string; status: string; message: string }>;
  schemaVersion: string;
}): string {
  const gates = (input.gateResults ?? [])
    .map((g) => `- ${g.gateId}: ${g.status} — ${g.message}`)
    .join("\n");
  return [
    "source: deterministic_quality_report_summary",
    `schema: ${input.schemaVersion}`,
    `quality_report_sha256: ${input.qualityReportSha256}`,
    `overall_status: ${input.overallStatus}`,
    "gates:",
    gates || "- (none)",
    `recommendation: ${recommendationFromQualityReportOverall(input.overallStatus)}`,
    "note: This is the default review product for the Phase 2U quality-report gate.",
    "note: It does not approve or reject the report; a human operator must decide.",
  ].join("\n");
}
