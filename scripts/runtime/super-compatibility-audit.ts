import {
  runSuperCompatibilityAudit,
  type SuperBootProbeMode,
} from "../../src/lib/engineer-console/super-compatibility/super-compatibility-audit";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function bootProbeMode(): SuperBootProbeMode {
  if (hasFlag("--allow-super-boot-probe") || hasFlag("--confirm-super-boot-probe")) {
    if (!hasFlag("--allow-super-boot-probe") || !hasFlag("--confirm-super-boot-probe")) {
      throw new Error("PHASE_8_SUPER_BOOT_PROBE_REQUIRES_ALLOW_AND_CONFIRM_FLAGS");
    }
    return "explicit_allowlisted_boot_probe";
  }
  if (hasFlag("--dry-run-boot-plan")) return "dry_run_plan_only";
  return "disabled";
}

async function main(): Promise<void> {
  if (!hasFlag("--non-loading")) {
    throw new Error("PHASE_8_SUPER_AUDIT_REQUIRES_NON_LOADING_MODE");
  }
  const result = await runSuperCompatibilityAudit({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/super-compatibility",
    bootProbeMode: bootProbeMode(),
  });
  const proofStatus = result.preflight_runtime_status === "healthy"
    && result.postflight_runtime_status === "healthy"
    && result.senior_role_resolution.status === "blocked_unproven"
    && !result.airllm_super_used
    && !result.qwen_used
    && !result.fallback_used
    && !result.super_model_load_performed
    && !result.super_model_inference_performed
    && !result.integration_performed
    ? "PASS"
    : "BLOCKED";
  process.stdout.write(`${JSON.stringify({
    status: proofStatus,
    final_verdict: result.final_verdict,
    audit_id: result.audit_id,
    evidence_path: result.evidence_path,
    senior_role_id: result.senior_role_id,
    senior_role_status: result.senior_role_resolution.status,
    configured_provider: result.configured_provider,
    configured_model_path: result.configured_model_path,
    expected_model: result.expected_model,
    audit_mode: result.audit_mode,
    artifact_status: result.model_artifact_check.status,
    artifact_path_exists: result.model_artifact_check.path_exists,
    artifact_total_size_bytes: result.model_artifact_check.total_size_bytes,
    dependency_statuses: result.dependency_checks.map((check) => ({
      name: check.name,
      status: check.status,
      diagnostics: check.diagnostics,
    })),
    hardware_status: result.hardware_snapshot.status,
    boot_probe_status: result.boot_probe_plan.status,
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    fallback_used: result.fallback_used,
    airllm_super_used: result.airllm_super_used,
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
