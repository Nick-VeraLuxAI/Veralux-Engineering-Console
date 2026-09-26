import { countSkillsByStatus, listShadowRetrievals, listSkills } from "./skill-store";
import { resolveSkillOptFlags } from "./skill-flags";

/**
 * Operational metrics only — do NOT claim SkillOpt effectiveness before A/B qualification.
 */
export function collectSkillOptMetrics(): {
  flags: ReturnType<typeof resolveSkillOptFlags>;
  countsByStatus: Record<string, number>;
  validatedCount: number;
  shadowRetrievalCount: number;
  injectionEvents: 0;
  effectivenessClaim: "none_pending_ab";
} {
  const flags = resolveSkillOptFlags();
  const countsByStatus = countSkillsByStatus();
  return {
    flags,
    countsByStatus,
    validatedCount: countsByStatus.validated ?? 0,
    shadowRetrievalCount: listShadowRetrievals().length,
    injectionEvents: 0,
    effectivenessClaim: "none_pending_ab",
  };
}

export function listValidatedSkillTitles(): string[] {
  return listSkills({ status: "validated" }).map((s) => s.title);
}
