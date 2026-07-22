/** Deterministic bounded senior-review prompt for quality-report advisory. */

import { createHash } from "crypto";
import { S16_MAX_NEW_TOKENS } from "./types";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildSeniorQualityReportPrompt(input: {
  qualityReportSummary: string;
  qualityReportSha256: string;
  defaultReviewContent: string;
  defaultReviewSha256: string;
  maxNewTokens?: number;
}): { prompt: string; promptSha256: string; maxNewTokens: number } {
  const maxNewTokens = input.maxNewTokens ?? S16_MAX_NEW_TOKENS;
  const prompt = [
    "Exact review scope: Vera post-patch quality report (Phase 2U).",
    `Quality report SHA-256: ${input.qualityReportSha256}`,
    `Default review SHA-256: ${input.defaultReviewSha256}`,
    "Quality report summary:",
    input.qualityReportSummary.slice(0, 1200),
    "Default review:",
    input.defaultReviewContent.slice(0, 800),
    "Requested output schema:",
    "recommendation: approve|reject|needs_revision|neutral",
    "Optional: finding: <short blocker>",
    `Maximum output length: ${maxNewTokens} tokens.`,
    "Identify approval blockers only.",
    "Distinguish observed evidence from recommendation.",
    "You are advising a human operator.",
    "You do not approve or reject this report.",
    "You do not authorize downstream actions.",
  ].join("\n");
  return { prompt, promptSha256: sha256Text(prompt), maxNewTokens };
}
