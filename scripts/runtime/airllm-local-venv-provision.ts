import { runAirLlmLocalVenvProvision } from "../../src/lib/engineer-console/airllm-environment/airllm-local-venv-provision";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (!hasFlag("--provision-local-venv")) {
    throw new Error("PHASE_10_REQUIRES_PROVISION_LOCAL_VENV_FLAG");
  }
  if (hasFlag("--allow-super-boot-probe") || hasFlag("--global") || hasFlag("--sudo") || hasFlag("--apt")) {
    throw new Error("PHASE_10_FORBIDS_BOOT_GLOBAL_SUDO_OR_APT");
  }

  const result = await runAirLlmLocalVenvProvision({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-environment",
  });
  const proofStatus = result.senior_role_resolution.status === "blocked_unproven"
    && result.import_proof_result.preflight_runtime_status === "healthy"
    && result.import_proof_result.postflight_runtime_status === "healthy"
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
    provision_id: result.provision_id,
    evidence_path: result.evidence_path,
    repo_root: result.repo_root,
    target_venv_path: result.target_venv_path,
    venv_gitignored: result.venv_gitignored,
    python_base_executable: result.python_base_executable,
    install_result: {
      status: result.install_result.status,
      exit_code: result.install_result.exit_code,
      stderr_summary: result.install_result.stderr_summary,
      diagnostics: result.install_result.diagnostics,
    },
    selected_runtime_path: result.selected_runtime_path,
    airllm_package_version: result.airllm_package_version,
    airllm_module_path: result.airllm_module_path,
    dependency_snapshot_status: result.dependency_snapshot.status,
    hardware_status: result.hardware_snapshot.status,
    boot_probe_status: result.import_proof_result.boot_probe_plan.status,
    preflight_runtime_status: result.import_proof_result.preflight_runtime_status,
    postflight_runtime_status: result.import_proof_result.postflight_runtime_status,
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
