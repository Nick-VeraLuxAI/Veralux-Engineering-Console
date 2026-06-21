import { runAirLlmWinningCandidatePromotion } from "../../src/lib/engineer-console/airllm-environment/airllm-winning-candidate-promotion";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (!hasFlag("--promote")) {
    throw new Error("PHASE_12_REQUIRES_PROMOTE_FLAG");
  }
  if (hasFlag("--allow-super-boot-probe") || hasFlag("--global") || hasFlag("--sudo") || hasFlag("--apt")) {
    throw new Error("PHASE_12_FORBIDS_BOOT_GLOBAL_SUDO_OR_APT");
  }
  const phase11EvidencePath = argValue("--phase11-evidence");
  if (!phase11EvidencePath) {
    throw new Error("PHASE_12_REQUIRES_PHASE11_EVIDENCE_PATH");
  }

  const result = await runAirLlmWinningCandidatePromotion({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-environment",
    phase11EvidencePath,
  });
  const proofStatus = result.senior_role_resolution.status === "blocked_unproven"
    && result.preflight_runtime_status === "healthy"
    && result.postflight_runtime_status === "healthy"
    && result.import_proof_result.boot_probe_plan.status === "disabled"
    && !result.fallback_used
    && !result.airllm_serving_started
    && !result.super_used
    && !result.qwen_used
    && !result.super_model_load_performed
    && !result.super_model_inference_performed
    && !result.integration_performed
    ? "PASS"
    : "BLOCKED";

  process.stdout.write(`${JSON.stringify({
    status: proofStatus,
    final_verdict: result.final_verdict,
    promotion_id: result.promotion_id,
    evidence_path: result.evidence_path,
    source_phase11_evidence_path: result.source_phase11_evidence_path,
    winning_candidate_id: result.winning_candidate_id,
    target_venv_path: result.target_venv_path,
    generated_requirements_path: result.generated_requirements_path,
    generated_lock_path: result.generated_lock_path,
    selected_runtime_path: result.selected_runtime_path,
    installed_package_versions: result.installed_package_versions,
    import_probe_status: result.import_probe_result.status,
    optimum_bettertransformer_resolved: result.import_probe_result.optimum_bettertransformer_resolved,
    airllm_import_resolved: result.import_probe_result.airllm_import_resolved,
    airllm_automodel_resolved: result.import_probe_result.airllm_automodel_resolved,
    phase9_final_verdict: result.import_proof_result.final_verdict,
    boot_probe_status: result.import_proof_result.boot_probe_plan.status,
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    fallback_used: result.fallback_used,
    airllm_serving_started: result.airllm_serving_started,
    super_used: result.super_used,
    qwen_used: result.qwen_used,
    super_model_load_performed: result.super_model_load_performed,
    super_model_inference_performed: result.super_model_inference_performed,
    integration_performed: result.integration_performed,
  }, null, 2)}\n`);

  if (proofStatus !== "PASS") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
