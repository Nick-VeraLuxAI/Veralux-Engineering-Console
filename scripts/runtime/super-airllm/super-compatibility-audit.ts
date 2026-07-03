import {
  runSuperCompatibilityAudit,
  type SuperBootProbeMode,
} from "../../../src/lib/engineer-console/experimental/super-airllm/super-compatibility/super-compatibility-audit";

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
      throw new Error("SUPER_AIRLLM_BOOT_PROBE_REQUIRES_ALLOW_AND_CONFIRM_FLAGS");
    }
    return "explicit_allowlisted_boot_probe";
  }
  if (hasFlag("--dry-run-boot-plan")) return "dry_run_plan_only";
  return "disabled";
}

async function main(): Promise<void> {
  if (!hasFlag("--non-loading")) {
    throw new Error("SUPER_AIRLLM_AUDIT_REQUIRES_NON_LOADING_MODE");
  }
  const result = await runSuperCompatibilityAudit({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/super-compatibility",
    bootProbeMode: bootProbeMode(),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.final_verdict === "go_for_future_boot_probe" ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
