import type { ModelProfile, ModelScope } from "./skill-types";
import { NEMOTRON_NANO_FAMILY, NEMOTRON_NANO_MODEL_ID } from "./skill-types";

export function classifyModelScope(input: {
  appliesToAllModels: boolean;
  familyOnly?: boolean;
  modelId?: string | null;
}): ModelScope {
  if (input.appliesToAllModels) return "model_independent";
  if (input.familyOnly) return "model_family";
  if (input.modelId) return "model_specific";
  return "model_independent";
}

/**
 * Whether a stored skill is eligible for a retrieval query under model-aware filtering.
 * model_independent → always eligible
 * model_family → eligible when query family matches
 * model_specific → eligible when query modelId matches
 */
export function skillMatchesModelScope(
  skill: {
    modelScope: ModelScope;
    modelFamily?: string | null;
    modelId?: string | null;
  },
  query: { modelId?: string | null; modelFamily?: string | null },
): boolean {
  if (skill.modelScope === "model_independent") return true;
  if (skill.modelScope === "model_family") {
    if (!query.modelFamily) return false;
    return (skill.modelFamily ?? "").toLowerCase() === query.modelFamily.toLowerCase();
  }
  if (skill.modelScope === "model_specific") {
    if (!query.modelId) return false;
    return (skill.modelId ?? "").toLowerCase() === query.modelId.toLowerCase();
  }
  return false;
}

export function inferModelFamily(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const m = modelId.toLowerCase();
  if (m.includes("nemotron") && m.includes("nano")) return NEMOTRON_NANO_FAMILY;
  if (m.includes("qwen")) return "qwen";
  if (m.includes("kimi")) return "kimi";
  return "unknown";
}

export const DEFAULT_NEMOTRON_PROFILE: ModelProfile = {
  modelId: NEMOTRON_NANO_MODEL_ID,
  modelFamily: NEMOTRON_NANO_FAMILY,
  displayName: "Nemotron Nano 30B A3B NVFP4",
  wrapperFidelityStatus: "audited_ok",
  skillOptEnabled: true,
  notes:
    "FAITHFUL invocation promoted. SkillOpt may store model-specific lessons but must not hide wrapper defects.",
};

/**
 * Future model onboarding workflow (documented + enforced as checklist helper).
 * Never skip fidelity audit or hide a broken wrapper behind SkillOpt.
 */
export function modelOnboardingChecklist(): string[] {
  return [
    "1. Fidelity audit of model wrapper / serve recipe",
    "2. Baseline AE qualification WITHOUT SkillOpt",
    "3. Enable model-independent SkillOpt experiment (shadow only)",
    "4. A/B compare vs baseline (no prompt injection until proven)",
    "5. Promote only after controlled A/B proves improvement without regression",
    "NEVER: use SkillOpt to paper over a broken model wrapper",
  ];
}
