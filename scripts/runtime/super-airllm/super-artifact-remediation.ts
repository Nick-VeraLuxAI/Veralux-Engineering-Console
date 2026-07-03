import path from "path";
import { runSuperArtifactRemediation } from "../../../src/lib/engineer-console/experimental/super-airllm/super-artifact-remediation/super-artifact-remediation";
import { readSuperModelPathFromEnv } from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const phase13EvidencePath = readArg("--phase13-evidence");
  if (!phase13EvidencePath) {
    console.error("Missing required --phase13-evidence <path>");
    process.exit(1);
  }

  const modelPath = readArg("--model-path") ?? readSuperModelPathFromEnv();
  const enabled = process.argv.includes("--enabled");

  const result = await runSuperArtifactRemediation({
    repoRoot,
    phase13EvidencePath: path.isAbsolute(phase13EvidencePath)
      ? path.relative(repoRoot, phase13EvidencePath)
      : phase13EvidencePath,
    modelPath,
    enabled,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.final_verdict === "remediation_verified" || result.final_verdict === "remediation_plan_ready" ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
