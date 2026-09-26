import type { SkillOptFlags } from "./skill-types";

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return defaultValue;
}

/**
 * SkillOpt feature flags.
 * Defaults: capture/extraction/shadow may be ON for learning-layer branch experiments;
 * prompt injection is ALWAYS default-false and production-guarded.
 */
export function resolveSkillOptFlags(overrides: Partial<SkillOptFlags> = {}): SkillOptFlags {
  const flags: SkillOptFlags = {
    capture: envBool("ENGINEER_CONSOLE_SKILLOPT_CAPTURE", true),
    extraction: envBool("ENGINEER_CONSOLE_SKILLOPT_EXTRACTION", true),
    shadowRetrieval: envBool("ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL", true),
    promptInjection: envBool("ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION", false),
    ...overrides,
  };
  return flags;
}

/**
 * Production guard: prompt injection is unsupported in SkillOpt V1.
 * Even if the env flag is set true, callers must treat this as blocked unless
 * an explicit future A/B qualification opt-in is wired (not present in V1).
 */
export function isPromptInjectionSupported(): boolean {
  return false;
}

export function assertPromptInjectionDisabled(flags: SkillOptFlags = resolveSkillOptFlags()): void {
  if (flags.promptInjection || isPromptInjectionSupported()) {
    // Still refuse — V1 has no supported activation path.
    throw new Error(
      "SKILLOPT_PROMPT_INJECTION_UNSUPPORTED: SkillOpt V1 forbids automatic prompt mutation.",
    );
  }
}
