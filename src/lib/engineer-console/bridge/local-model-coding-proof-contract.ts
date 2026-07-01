import {
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  validateVeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

export const VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION =
  "vera_builder_loop_local_model_coding_proof_v1" as const;

export const VERA_LOCAL_MODEL_CODING_TASK_ID =
  "format_builder_loop_decision_label_v1" as const;

export type VeraLocalModelCodingProofHandoff = VeraPlaceholderModuleCardHandoff & {
  coding_task_id: typeof VERA_LOCAL_MODEL_CODING_TASK_ID;
};

export function validateVeraLocalModelCodingProofHandoff(raw: unknown): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  handoff?: VeraLocalModelCodingProofHandoff;
} {
  const validation = validateVeraPlaceholderModuleCardHandoff(raw);
  if (!validation.ok || !validation.placeholder_artifact) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const handoff = raw as VeraPlaceholderModuleCardHandoff;
  const errors = [...validation.errors];
  const codingTaskId = typeof (raw as Record<string, unknown>).coding_task_id === "string"
    ? String((raw as Record<string, unknown>).coding_task_id)
    : "";
  if (codingTaskId !== VERA_LOCAL_MODEL_CODING_TASK_ID) {
    errors.push(`coding_task_id must be ${VERA_LOCAL_MODEL_CODING_TASK_ID}.`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings: validation.warnings };
  }
  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    handoff: {
      ...handoff,
      schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
      coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
    },
  };
}
