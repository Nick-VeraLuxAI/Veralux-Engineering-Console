import {
  DEFAULT_AIRLLM_NEMOTRON_COMPATIBILITY_CONFIG,
  runAirLlmNemotronCompatibilityProof,
} from "../../src/lib/engineer-console/airllm-nemotron-compatibility/airllm-nemotron-compatibility";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (hasFlag("--serve") || hasFlag("--server") || hasFlag("--generate") || hasFlag("--prompt")) {
    throw new Error("PHASE_15_FORBIDS_SERVING_GENERATION_OR_PROMPTS");
  }
  if (hasFlag("--sudo") || hasFlag("--apt") || hasFlag("--global") || hasFlag("--pip-install")) {
    throw new Error("PHASE_15_FORBIDS_GLOBAL_SYSTEM_MUTATION");
  }
  if (hasFlag("--delete-original")) {
    throw new Error("PHASE_15_FORBIDS_DELETE_ORIGINAL");
  }
  if (hasFlag("--enable-guarded-compatibility-load")) {
    throw new Error("PHASE_15_GUARDED_LOAD_NOT_IMPLEMENTED_IN_DEFAULT_PROOF");
  }

  const phase13Evidence = argValue("--phase13-evidence");
  const phase14Evidence = argValue("--phase14-evidence");
  if (!phase13Evidence || !phase14Evidence) {
    throw new Error("PHASE_15_REQUIRES_PHASE13_AND_PHASE14_EVIDENCE");
  }

  const result = await runAirLlmNemotronCompatibilityProof({
    phase13EvidencePath: phase13Evidence,
    phase14EvidencePath: phase14Evidence,
    modelPath: argValue("--model-path") ?? DEFAULT_AIRLLM_NEMOTRON_COMPATIBILITY_CONFIG.modelPath,
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-nemotron-compatibility",
  });

  const status = result.safety_gates.every((gate) => gate.status === "passed")
    && !result.site_packages_modified
    && !result.model_load_attempted
    && !result.split_shards_written
    && !result.inference_or_generation_occurred
    && !result.serving_occurred
    && !result.qwen_used
    && !result.fallback_used
    && !result.integration_performed
    ? "PASS"
    : "BLOCKED";

  process.stdout.write(`${JSON.stringify({
    status,
    final_verdict: result.final_verdict,
    compatibility_id: result.compatibility_id,
    evidence_path: result.evidence_path,
    phase13_evidence_path: result.phase13_evidence_path,
    phase14_evidence_path: result.phase14_evidence_path,
    architecture: result.config_analysis.architecture,
    model_type: result.config_analysis.model_type,
    airllm_version: result.airllm_source_audit.airllm_version,
    unknown_architecture_fallback: result.airllm_source_audit.unknown_architecture_fallback,
    layer_count: result.weight_prefix_analysis.layer_count,
    split_simulation_status: result.split_simulation.status,
    empty_layers: result.split_simulation.empty_layers,
    overlay_dry_run_status: result.overlay_dry_run.status,
    site_packages_modified: result.site_packages_modified,
    model_load_attempted: result.model_load_attempted,
    split_shards_written: result.split_shards_written,
    inference_or_generation_occurred: result.inference_or_generation_occurred,
    serving_occurred: result.serving_occurred,
    qwen_used: result.qwen_used,
    fallback_used: result.fallback_used,
    integration_performed: result.integration_performed,
    senior_role_status: result.senior_role_resolution.status,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    recommended_next_action: result.recommended_next_action,
  }, null, 2)}\n`);

  if (status !== "PASS") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
