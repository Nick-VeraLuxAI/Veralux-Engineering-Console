import { createHash } from "crypto";
import type { EvidencePolarity, EvidenceReference } from "./skill-types";

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeFailureSignature(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w:./\- ]+/g, "")
    .slice(0, 240);
}

export interface EvidenceLinkInput {
  skillId: string;
  polarity: EvidencePolarity;
  refPath: string;
  refKind: EvidenceReference["refKind"];
  runId?: string | null;
  taskId?: string | null;
  summary?: string | null;
  id?: string;
  createdAt?: string;
}

/** Build an evidence reference without copying huge logs into the skill row. */
export function buildEvidenceReference(input: EvidenceLinkInput): EvidenceReference {
  return {
    id: input.id ?? `ev_${createHash("sha1").update(`${input.skillId}:${input.refPath}:${input.polarity}`).digest("hex").slice(0, 16)}`,
    skillId: input.skillId,
    polarity: input.polarity,
    refPath: input.refPath,
    refKind: input.refKind,
    runId: input.runId ?? null,
    taskId: input.taskId ?? null,
    summary: input.summary ? input.summary.slice(0, 500) : null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Confidence from explicit rules (not opaque ML scores).
 * Base 0.35 for candidate; +0.15 per distinct positive evidence (cap 3);
 * +0.1 per validation; −0.2 per rejection; clamp [0, 1].
 */
export function deriveConfidence(input: {
  status: string;
  validationCount: number;
  rejectionCount: number;
  positiveEvidenceCount: number;
}): number {
  let c = input.status === "validated" ? 0.55 : 0.35;
  c += Math.min(3, Math.max(0, input.positiveEvidenceCount)) * 0.15;
  c += Math.max(0, input.validationCount) * 0.1;
  c -= Math.max(0, input.rejectionCount) * 0.2;
  if (input.status === "rejected" || input.status === "deprecated") c = Math.min(c, 0.2);
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}
