import { resolveSkillOptFlags } from "./skill-flags";
import { shadowRetrieve, assertAePromptUnchanged } from "./shadow-retrieval";
import { inferModelFamily } from "./skill-model-scope";
import type { AutonomousDocument } from "../autonomous-engineer/types";
import { auditAutonomousEvent } from "../autonomous-engineer/audit";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";

/**
 * AE planning hook: shadow-rank skills and prove prompt unchanged.
 * Returns the original prompt always. No production feedback into AE.
 */
export function maybeShadowRetrieveForPlanning(input: {
  runId: string;
  taskId: string;
  prompt: string;
  document: AutonomousDocument;
}): string {
  const flags = resolveSkillOptFlags();
  if (!flags.shadowRetrieval) return input.prompt;

  const modelId = input.document.workerModel?.modelName ?? null;
  const signatures = [
    input.document.failureClass ?? "",
    input.document.diagnosis?.observed_failure ?? "",
    ...(input.document.failedHypotheses ?? []).map(String).slice(0, 5),
  ].filter(Boolean);

  const result = shadowRetrieve(input.prompt, {
    runId: input.runId,
    taskId: input.taskId,
    signatures,
    modelId,
    modelFamily: inferModelFamily(modelId),
    taskText: input.document.originalObjective,
    limit: 5,
  });

  assertAePromptUnchanged(input.prompt, result.promptUnchanged);

  try {
    auditAutonomousEvent(AUDIT_EVENT_TYPES.SKILLOPT_SHADOW_RETRIEVAL, input.runId, input.taskId, {
      matched: result.record?.matchedSkillIds ?? [],
      actuallyInjected: false,
      promptHashBefore: result.record?.promptHashBefore,
      promptHashAfter: result.record?.promptHashAfter,
    });
  } catch {
    // ignore audit failures
  }

  return result.promptUnchanged;
}
