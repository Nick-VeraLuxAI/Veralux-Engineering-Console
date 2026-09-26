/**
 * SkillOpt V1 — passive, evidence-grounded institutional memory.
 * NEVER silently mutates AE prompts. Prompt injection remains OFF / UNSUPPORTED in production.
 */

export const SKILL_STATUSES = ["candidate", "validated", "rejected", "deprecated"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const LESSON_TYPES = [
  "engineering",
  "testing",
  "diagnosis",
  "review",
  "acceptance",
  "runtime",
  "model_invocation",
  "governance",
] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

/** Critical classification — every skill must declare one. */
export const MODEL_SCOPES = ["model_independent", "model_family", "model_specific"] as const;
export type ModelScope = (typeof MODEL_SCOPES)[number];

export const EVIDENCE_POLARITIES = ["positive", "negative"] as const;
export type EvidencePolarity = (typeof EVIDENCE_POLARITIES)[number];

export interface EvidenceReference {
  id: string;
  skillId: string;
  polarity: EvidencePolarity;
  /** Absolute or repo-relative path / URI — do not embed huge logs. */
  refPath: string;
  refKind: "run_json" | "sot" | "audit" | "qc" | "plan" | "review" | "other";
  runId?: string | null;
  taskId?: string | null;
  summary?: string | null;
  createdAt: string;
}

export interface SkillRecord {
  id: string;
  status: SkillStatus;
  lessonType: LessonType;
  modelScope: ModelScope;
  /** Family id when model_family (e.g. nemotron-nano); model id when model_specific. */
  modelFamily?: string | null;
  modelId?: string | null;
  /** Normalized failure / lesson signature for retrieval gating. */
  signature: string;
  title: string;
  lesson: string;
  antiPatterns: string[];
  tags: string[];
  confidence: number;
  validationCount: number;
  rejectionCount: number;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: number;
  lesson: string;
  antiPatterns: string[];
  changeReason: string;
  createdAt: string;
}

export interface SkillValidationRecord {
  id: string;
  skillId: string;
  action: "validate" | "reject" | "deprecate";
  reason: string;
  actor: string;
  createdAt: string;
}

export interface ShadowRetrievalRecord {
  id: string;
  runId: string;
  taskId?: string | null;
  modelId?: string | null;
  modelFamily?: string | null;
  querySignature: string;
  taskContextDigest: string;
  matchedSkillIds: string[];
  /** Text that WOULD have been injected — never applied in V1. */
  wouldInject: string;
  /** Always false in SkillOpt V1. */
  actuallyInjected: false;
  promptHashBefore: string;
  promptHashAfter: string;
  rankingScores: Record<string, number>;
  createdAt: string;
}

export interface SkillCandidateProposal {
  lessonType: LessonType;
  modelScope: ModelScope;
  modelFamily?: string | null;
  modelId?: string | null;
  signature: string;
  title: string;
  lesson: string;
  antiPatterns: string[];
  tags: string[];
  evidence: Array<{
    polarity: EvidencePolarity;
    refPath: string;
    refKind: EvidenceReference["refKind"];
    runId?: string | null;
    taskId?: string | null;
    summary?: string | null;
  }>;
  /** Extractor notes — proposals only until curated. */
  extractorNotes?: string;
}

export interface ModelProfile {
  modelId: string;
  modelFamily: string;
  displayName: string;
  /** SkillOpt must never hide a broken wrapper. */
  wrapperFidelityStatus: "unknown" | "audited_ok" | "audited_broken";
  skillOptEnabled: boolean;
  notes?: string;
}

export interface SkillOptFlags {
  capture: boolean;
  extraction: boolean;
  shadowRetrieval: boolean;
  /** Must remain false in V1 production. */
  promptInjection: boolean;
}

export interface RetrievalQuery {
  runId: string;
  taskId?: string | null;
  signatures: string[];
  lessonTypes?: LessonType[];
  modelId?: string | null;
  modelFamily?: string | null;
  taskText?: string;
  /** Max skills to rank into wouldInject text. */
  limit?: number;
}

export const NEMOTRON_NANO_MODEL_ID = "Nemotron-Nano-30B-A3B-NVFP4";
export const NEMOTRON_NANO_FAMILY = "nemotron-nano";
