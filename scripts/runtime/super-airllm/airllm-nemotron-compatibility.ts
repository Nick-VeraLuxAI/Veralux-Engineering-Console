import { runAirLlmNemotronCompatibilityProof } from "../../../src/lib/engineer-console/experimental/super-airllm/airllm-nemotron-compatibility/airllm-nemotron-compatibility";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const phase13 = argValue("--phase13-evidence");
  const phase14 = argValue("--phase14-evidence");
  if (!phase13 || !phase14) {
    throw new Error("SUPER_AIRLLM_NEMOTRON_COMPAT_REQUIRES_PHASE13_AND_PHASE14_EVIDENCE");
  }
  const result = await runAirLlmNemotronCompatibilityProof({
    evidenceRoot: argValue("--evidence-root") ?? "evidence/airllm-nemotron-compatibility",
    phase13EvidencePath: phase13,
    phase14EvidencePath: phase14,
    modelPath: argValue("--model-path") ?? undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(
    result.final_verdict === "compatibility_requires_fork"
      || result.final_verdict === "compatibility_patch_viable"
      ? 0
      : 2,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
