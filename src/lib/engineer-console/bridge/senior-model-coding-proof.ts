import {
  validateVeraLocalModelCodingProofHandoff,
  VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
} from "./local-model-coding-proof-contract";
import { resolveCodingTaskSpec } from "./local-model-coding-task";
import { isScaffoldFirstTask } from "./local-model-coding-scaffold";
import {
  runVeraLocalModelCodingProof,
  type LocalModelCodingProofDeps,
  type VeraLocalModelCodingProofResult,
} from "./local-model-coding-proof";
import { getLocalModelCodingConfig } from "./local-model-coding-config";
import {
  getSeniorModelCodingConfig,
  seniorModelConfigCollidesWithLocalWorker,
} from "./senior-model-coding-config";

export type SeniorModelCodingProofDeps = Omit<LocalModelCodingProofDeps, "lane" | "config">;

function isSeniorEligibleScaffoldTask(
  handoff: NonNullable<ReturnType<typeof validateVeraLocalModelCodingProofHandoff>["handoff"]>,
): boolean {
  if (handoff.coding_task && isScaffoldFirstTask(handoff.coding_task)) {
    return true;
  }
  if ((handoff.coding_task?.model_editable_files?.length ?? 0) > 0) {
    return true;
  }
  return handoff.coding_task_id === VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID;
}

export async function runVeraSeniorModelCodingProof(
  raw: unknown,
  deps: SeniorModelCodingProofDeps = {},
): Promise<VeraLocalModelCodingProofResult> {
  const validation = validateVeraLocalModelCodingProofHandoff(raw);
  if (!validation.ok || !validation.handoff) {
    return runVeraLocalModelCodingProof(raw, {
      ...deps,
      lane: "senior_model_scaffold_retry",
    });
  }

  const handoff = validation.handoff;

  if (!isSeniorEligibleScaffoldTask(handoff)) {
    return {
      ok: false,
      status: "rejected",
      schema_version: "vera_builder_loop_local_model_coding_proof_v1",
      placeholder_schema_version: "vera_builder_loop_placeholder_module_card_v1",
      errors: [
        "Senior model coding proof requires a scaffold-first coding task or explicit model_editable_files.",
      ],
      warnings: [
        "Senior scaffold retry is bounded to preset scaffold-first tasks in V2b.",
      ],
      coding_task_id: handoff.coding_task_id,
      ...(handoff.builder_loop_mode ? { builder_loop_mode: handoff.builder_loop_mode } : {}),
      boundary_flags: {
        local_model_coding_proof: true,
        system_source_of_truth: true,
        console_metadata_authoritative: false,
        repo_mutation_authorized: false,
        branch_creation_authorized: false,
        commit_creation_authorized: false,
        pr_creation_authorized: false,
        deploy_authorized: false,
        merge_authorized: false,
        final_integration_authorized: false,
        arbitrary_execution_authorized: false,
        arbitrary_filesystem_path_authorized: false,
        production_data_used: false,
        model_generation_real: false,
      },
      execution_mode: "senior_model_scaffold_retry",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      console_metadata_authoritative: false,
    };
  }

  const taskSpec = resolveCodingTaskSpec(handoff);
  const resultContext = {
    coding_task_id: handoff.coding_task_id,
    ...(handoff.builder_loop_mode ? { builder_loop_mode: handoff.builder_loop_mode } : {}),
  };

  if (taskSpec.orchestrationMode !== "scaffold_first") {
    return {
      ok: false,
      status: "rejected",
      schema_version: "vera_builder_loop_local_model_coding_proof_v1",
      placeholder_schema_version: "vera_builder_loop_placeholder_module_card_v1",
      errors: [
        "Senior model coding proof requires scaffold-first orchestration.",
      ],
      warnings: [
        "Senior scaffold retry is bounded to preset scaffold-first tasks in V2b.",
      ],
      ...resultContext,
      boundary_flags: {
        local_model_coding_proof: true,
        system_source_of_truth: true,
        console_metadata_authoritative: false,
        repo_mutation_authorized: false,
        branch_creation_authorized: false,
        commit_creation_authorized: false,
        pr_creation_authorized: false,
        deploy_authorized: false,
        merge_authorized: false,
        final_integration_authorized: false,
        arbitrary_execution_authorized: false,
        arbitrary_filesystem_path_authorized: false,
        production_data_used: false,
        model_generation_real: false,
      },
      execution_mode: "senior_model_scaffold_retry",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      console_metadata_authoritative: false,
    };
  }

  const seniorConfig = getSeniorModelCodingConfig(deps.env);
  const localConfig = getLocalModelCodingConfig(deps.env);
  if (seniorModelConfigCollidesWithLocalWorker(seniorConfig, localConfig)) {
    return {
      ok: false,
      status: "rejected",
      schema_version: "vera_builder_loop_local_model_coding_proof_v1",
      placeholder_schema_version: "vera_builder_loop_placeholder_module_card_v1",
      errors: [
        "Senior model config collides with local default worker endpoint/model. Configure a distinct ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL and ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL.",
      ],
      warnings: [
        "Senior scaffold retry must not silently reuse the Nemotron default worker configuration.",
      ],
      ...resultContext,
      boundary_flags: {
        local_model_coding_proof: true,
        system_source_of_truth: true,
        console_metadata_authoritative: false,
        repo_mutation_authorized: false,
        branch_creation_authorized: false,
        commit_creation_authorized: false,
        pr_creation_authorized: false,
        deploy_authorized: false,
        merge_authorized: false,
        final_integration_authorized: false,
        arbitrary_execution_authorized: false,
        arbitrary_filesystem_path_authorized: false,
        production_data_used: false,
        model_generation_real: false,
      },
      execution_mode: "senior_model_scaffold_retry",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      console_metadata_authoritative: false,
    };
  }

  return runVeraLocalModelCodingProof(raw, {
    ...deps,
    lane: "senior_model_scaffold_retry",
    config: seniorConfig,
    maxRepairAttempts: seniorConfig.maxRepairAttempts,
  });
}
