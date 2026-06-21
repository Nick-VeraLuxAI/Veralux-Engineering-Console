import {
  DEFAULT_SUPER_BOOT_PROBE_CONFIG,
  runGuardedSuperBootProbe,
} from "../../src/lib/engineer-console/super-boot-probe/super-boot-probe";

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
    throw new Error("PHASE_13_FORBIDS_SERVING_GENERATION_OR_PROMPTS");
  }
  if (hasFlag("--sudo") || hasFlag("--apt") || hasFlag("--global")) {
    throw new Error("PHASE_13_FORBIDS_GLOBAL_SYSTEM_MUTATION");
  }
  const timeout = Number(argValue("--timeout-seconds") ?? "600");
  const result = await runGuardedSuperBootProbe({
    enabled: hasFlag("--enable-guarded-boot-probe"),
    timeoutSeconds: Number.isFinite(timeout) ? timeout : 600,
    evidenceRoot: argValue("--evidence-root") ?? "evidence/super-boot-probe",
    phase12EvidencePath: argValue("--phase12-evidence") ?? DEFAULT_SUPER_BOOT_PROBE_CONFIG.phase12EvidencePath,
  });

  const proofStatus = result.final_verdict !== "boot_probe_unsafe"
    && result.senior_role_resolution.status === "blocked_unproven"
    && !result.inference_or_generation_occurred
    && !result.serving_occurred
    && !result.qwen_used
    && !result.fallback_used
    && !result.integration_performed
    && !result.senior_role_promoted
    ? "PASS"
    : "BLOCKED";

  process.stdout.write(`${JSON.stringify({
    status: proofStatus,
    final_verdict: result.final_verdict,
    probe_id: result.probe_id,
    evidence_path: result.evidence_path,
    runtime_path: result.airllm_runtime_path,
    model_path: result.model_path,
    timeout_seconds: result.timeout_seconds,
    child_launched: result.child_process.launched,
    child_pid: result.child_process.pid,
    child_exit_code: result.child_process.exit_code,
    child_signal: result.child_process.signal,
    cleanup_status: result.child_process.cleanup_status,
    model_load_attempted: result.model_load_attempted,
    model_load_completed: result.model_load_completed,
    inference_or_generation_occurred: result.inference_or_generation_occurred,
    serving_occurred: result.serving_occurred,
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    senior_role_status: result.senior_role_resolution.status,
    resource_snapshot_count: result.resource_snapshots.length,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    recommended_next_action: result.recommended_next_action,
    qwen_used: result.qwen_used,
    fallback_used: result.fallback_used,
    integration_performed: result.integration_performed,
    senior_role_promoted: result.senior_role_promoted,
  }, null, 2)}\n`);

  if (proofStatus !== "PASS") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
