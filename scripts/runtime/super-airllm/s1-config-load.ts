import { analyzeNemotronConfig } from "../../../src/lib/engineer-console/experimental/super-airllm/airllm-nemotron-compatibility/airllm-nemotron-compatibility";
import { readSuperModelPathFromEnv, NEMOTRONH_ARCHITECTURE } from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const modelPath = readArg("--model-path") ?? readSuperModelPathFromEnv();
  const config = await analyzeNemotronConfig(modelPath);
  const passed = config.architecture === NEMOTRONH_ARCHITECTURE && config.diagnostics.length === 0;

  const result = {
    phase: "super_airllm_repair_s2_l3_config_load",
    verdict: passed ? "config_load_ready" : "config_load_blocked",
    model_path: modelPath,
    config_analysis: config,
    model_load_performed: false,
    gpu_use_performed: false,
    tensor_load_performed: false,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(passed ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
