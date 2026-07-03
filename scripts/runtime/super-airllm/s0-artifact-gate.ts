import { runSuperS0ArtifactGate } from "../../../src/lib/engineer-console/experimental/super-airllm/s0-artifact-gate";
import { SUPER_CANONICAL_MODEL_PATH } from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

async function main(): Promise<void> {
  const modelPath = process.argv.includes("--model-path")
    ? process.argv[process.argv.indexOf("--model-path") + 1]
    : SUPER_CANONICAL_MODEL_PATH;

  const result = await runSuperS0ArtifactGate(modelPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "artifact_present" ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
