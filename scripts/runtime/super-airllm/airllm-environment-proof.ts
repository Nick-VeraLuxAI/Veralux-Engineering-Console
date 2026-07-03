import { runAirLlmEnvironmentProof } from "../../../src/lib/engineer-console/experimental/super-airllm/airllm-environment/airllm-environment-proof";

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
    throw new Error("SUPER_AIRLLM_ENV_PROOF_REQUIRES_IMPORT_ONLY_MODE");
  }
  const result = await runAirLlmEnvironmentProof({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-environment",
    mode: "import_only_no_model_load",
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.final_verdict === "ready_for_guarded_boot_probe" ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
