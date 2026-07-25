/** Deterministic bounded senior PR-readiness review prompt. */

import { createHash } from "crypto";
import { S17_MAX_NEW_TOKENS } from "./types";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildSeniorPrReadinessPrompt(input: {
  prPreparationSummary: string;
  prPreparationSha256: string;
  qualityReportSha256?: string;
  defaultReviewContent: string;
  defaultReviewSha256: string;
  branchName?: string;
  commitSha?: string;
  maxNewTokens?: number;
}): { prompt: string; promptSha256: string; maxNewTokens: number } {
  const maxNewTokens = input.maxNewTokens ?? S17_MAX_NEW_TOKENS;
  const prompt = [
    "Exact review scope: Vera pull-request readiness (Phase 2X preparation).",
    `PR preparation SHA-256: ${input.prPreparationSha256}`,
    `Quality report SHA-256: ${input.qualityReportSha256 ?? "(none)"}`,
    `Default review SHA-256: ${input.defaultReviewSha256}`,
    `Branch: ${input.branchName ?? "(none)"}`,
    `Commit: ${input.commitSha ?? "(none)"}`,
    "PR preparation summary:",
    input.prPreparationSummary.slice(0, 1200),
    "Default review:",
    input.defaultReviewContent.slice(0, 800),
    "Requested output schema:",
    "recommendation: ready|not_ready|needs_revision|neutral",
    "Optional: finding: <short readiness blocker>",
    `Maximum output length: ${maxNewTokens} tokens.`,
    "Identify pull-request readiness blockers only.",
    "Distinguish observed evidence from recommendation.",
    "You are advising a human operator.",
    "You do not mark this pull request ready or not ready.",
    "You do not create, push, or authorize any pull request.",
  ].join("\n");
  return { prompt, promptSha256: sha256Text(prompt), maxNewTokens };
}
