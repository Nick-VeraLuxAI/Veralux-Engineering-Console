import { runAirLlmCompatibilityMatrix } from "../../src/lib/engineer-console/airllm-environment/airllm-compatibility-matrix";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (!hasFlag("--run-approved-matrix")) {
    throw new Error("PHASE_11_REQUIRES_RUN_APPROVED_MATRIX_FLAG");
  }
  if (hasFlag("--allow-super-boot-probe") || hasFlag("--global") || hasFlag("--sudo") || hasFlag("--apt")) {
    throw new Error("PHASE_11_FORBIDS_BOOT_GLOBAL_SUDO_OR_APT");
  }

  const result = await runAirLlmCompatibilityMatrix({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-compatibility-matrix",
  });
  const proofStatus = result.senior_role_resolution.status === "blocked_unproven"
    && result.preflight_runtime_status === "healthy"
    && result.postflight_runtime_status === "healthy"
    && result.boot_probe_status === "disabled"
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
    matrix_id: result.matrix_id,
    evidence_path: result.evidence_path,
    repo_commit_at_start: result.repo_commit_at_start,
    candidate_count: result.candidates.length,
    attempted_candidate_count: result.candidate_results.length,
    winner_candidate_id: result.winner_candidate_id,
    candidate_results: result.candidate_results.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      verdict: candidate.verdict,
      reason: candidate.reason,
      python: candidate.python_runtime_target.executable,
      venv_path: candidate.venv_path,
      requested: candidate.package_versions_requested,
      installed: candidate.package_versions_installed,
      optimum_bettertransformer_resolved: candidate.optimum_bettertransformer_resolved,
      airllm_automodel_resolved: candidate.airllm_automodel_resolved,
    })),
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    boot_probe_status: result.boot_probe_status,
    matrix_gitignored: result.matrix_gitignored,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    recommended_next_action: result.recommended_next_action,
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
