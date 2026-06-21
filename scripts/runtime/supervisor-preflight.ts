import { runRuntimeSupervisorPreflight } from "../../src/lib/engineer-console/runtime-supervisor/runtime-supervisor";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const recover = hasFlag("--recover");
  if (recover && hasFlag("--check-only")) {
    throw new Error("PHASE_6_SUPERVISOR_RECOVER_AND_CHECK_ONLY_CONFLICT");
  }
  const report = await runRuntimeSupervisorPreflight({
    recover,
    smokeChecks: !hasFlag("--skip-smoke"),
    evidenceRoot: argValue("--evidence-root") ?? "evidence/runtime-supervisor",
  });

  process.stdout.write(`${JSON.stringify({
    status: report.status,
    evidence_path: report.evidence_path,
    check_only: report.check_only,
    recovery_enabled: report.recovery_enabled,
    required_roles: report.required_roles,
    role_health: report.role_health.map((health) => ({
      role_id: health.role_id,
      status: health.status,
      endpoint: health.endpoint,
      expected_model: health.expected_model,
      models_endpoint_ok: health.models_endpoint_ok,
      expected_model_present: health.expected_model_present,
      smoke_check_ok: health.smoke_check_ok,
      recovery_supported: health.recovery_supported,
      recovery_attempted: health.recovery_attempted,
      recovery_result_status: health.recovery_result?.status ?? null,
    })),
    blocked_reasons: report.blocked_reasons,
    fallback_used: report.fallback_used,
    airllm_super_used: report.airllm_super_used,
    qwen_used: report.qwen_used,
    integration_performed: report.integration_performed,
  }, null, 2)}\n`);

  if (report.status !== "healthy") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
