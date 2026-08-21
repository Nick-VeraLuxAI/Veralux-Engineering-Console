import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { resolveSkillOptFlags, isPromptInjectionSupported } from "./skill-flags";
import { hashPrompt } from "./skill-evidence";
import { listSkills, insertShadowRetrieval } from "./skill-store";
import { formatWouldInjectBlock, rankSkillsForRetrieval } from "./skill-retriever";
import type { RetrievalQuery, ShadowRetrievalRecord, SkillRecord } from "./skill-types";

export interface ShadowRetrievalResult {
  record: ShadowRetrievalRecord | null;
  ranked: ReturnType<typeof rankSkillsForRetrieval>;
  /** Always identical to input prompt in V1. */
  promptUnchanged: string;
  actuallyInjected: false;
}

/**
 * SHADOW MODE ONLY.
 * Persists wouldInject; actuallyInjected is always false.
 * Returns the original prompt unchanged.
 */
export function shadowRetrieve(
  prompt: string,
  query: RetrievalQuery,
  skills?: SkillRecord[],
): ShadowRetrievalResult {
  const flags = resolveSkillOptFlags();
  if (!flags.shadowRetrieval) {
    return {
      record: null,
      ranked: [],
      promptUnchanged: prompt,
      actuallyInjected: false,
    };
  }

  const pool = skills ?? listSkills({ status: "validated" });
  const ranked = rankSkillsForRetrieval(pool, query);
  const wouldInject = formatWouldInjectBlock(ranked);
  const before = hashPrompt(prompt);
  // Critical: do not mutate prompt
  const afterPrompt = prompt;
  const after = hashPrompt(afterPrompt);

  const record: ShadowRetrievalRecord = {
    id: uuidv4(),
    runId: query.runId,
    taskId: query.taskId,
    modelId: query.modelId,
    modelFamily: query.modelFamily,
    querySignature: query.signatures.map((s) => s).join("|").slice(0, 500),
    taskContextDigest: createHash("sha256")
      .update(query.taskText ?? "")
      .digest("hex")
      .slice(0, 32),
    matchedSkillIds: ranked.map((r) => r.skill.id),
    wouldInject,
    actuallyInjected: false,
    promptHashBefore: before,
    promptHashAfter: after,
    rankingScores: Object.fromEntries(ranked.map((r) => [r.skill.id, r.score])),
    createdAt: new Date().toISOString(),
  };

  try {
    insertShadowRetrieval(record);
  } catch {
    // Shadow must never break AE runs
  }

  return {
    record,
    ranked,
    promptUnchanged: afterPrompt,
    actuallyInjected: false,
  };
}

/**
 * Active injection interface — OFF / UNSUPPORTED in V1.
 * Exists so tests can prove it is unused and always returns the original prompt.
 */
export function applySkillPromptInjection(
  prompt: string,
  _skills: SkillRecord[],
): { prompt: string; injected: boolean; reason: string } {
  if (!isPromptInjectionSupported()) {
    return {
      prompt,
      injected: false,
      reason: "SKILLOPT_PROMPT_INJECTION_UNSUPPORTED",
    };
  }
  // Unreachable in V1 — still never mutate
  return { prompt, injected: false, reason: "injection_disabled" };
}

/** Hard safety: production AE prompt must equal pre-SkillOpt prompt. */
export function assertAePromptUnchanged(before: string, after: string): void {
  if (before !== after) {
    throw new Error("AE_PROMPT_MODIFIED_BY_SKILLOPT");
  }
  if (hashPrompt(before) !== hashPrompt(after)) {
    throw new Error("AE_PROMPT_HASH_MODIFIED_BY_SKILLOPT");
  }
}
