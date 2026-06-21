import { runAirLlmEnvironmentProof } from "../../src/lib/engineer-console/airllm-environment/airllm-environment-proof";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (!hasFlag("--import-only")) {
    throw new Error("PHASE_9_AIRLLM_PROOF_REQUIRES_IMPORT_ONLY_MODE");
  }
  if (hasFlag("--install") || hasFlag("--provision") || hasFlag("--allow-super-boot-probe")) {
    throw new Error("PHASE_9_FORBIDS_INSTALL_PROVISION_OR_BOOT_PROBE");
  }

  const result = await runAirLlmEnvironmentProof({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-environment",
  });
  const proofStatus = result.preflight_runtime_status === "healthy"
    && result.postflight_runtime_status === "healthy"
    && result.senior_role_resolution.status === "blocked_unproven"
    && !result.airllm_serving_started
    && !result.super_used
    && !result.qwen_used
    && !result.fallback_used
    && !result.super_model_load_performed
    && !result.super_model_inference_performed
    && !result.integration_performed
    && result.boot_probe_plan.status === "disabled"
    ? "PASS"
    : "BLOCKED";

  process.stdout.write(`${JSON.stringify({
    status: proofStatus,
    final_verdict: result.final_verdict,
    proof_id: result.proof_id,
    evidence_path: result.evidence_path,
    senior_role_id: result.senior_role_id,
    senior_role_status: result.senior_role_resolution.status,
    configured_provider: result.configured_provider,
    configured_model_path: result.configured_model_path,
    expected_model: result.expected_model,
    proof_mode: result.proof_mode,
    runtime_candidates: result.python_runtime_candidates.map((candidate) => ({
      executable: candidate.executable,
      source: candidate.source,
      exists: candidate.exists,
      version: candidate.version,
      diagnostics: candidate.diagnostics,
    })),
    selected_runtime_path: result.selected_runtime_path,
    airllm_import_status: result.airllm_import_check.status,
    airllm_version: result.airllm_import_check.version,
    airllm_module_path: result.airllm_import_check.module_path,
    dependency_snapshot_status: result.dependency_snapshot.status,
    torch_version: result.dependency_snapshot.torch_version,
    torch_cuda_available: result.dependency_snapshot.torch_cuda_available,
    hardware_status: result.hardware_snapshot.status,
    boot_probe_status: result.boot_probe_plan.status,
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    provisioning_plan: result.provisioning_plan,
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
