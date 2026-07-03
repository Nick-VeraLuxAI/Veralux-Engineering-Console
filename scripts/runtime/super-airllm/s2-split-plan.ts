import {
  analyzeNemotronConfig,
  analyzeNemotronWeights,
  simulateNemotronSplit,
} from "../../../src/lib/engineer-console/experimental/super-airllm/airllm-nemotron-compatibility/airllm-nemotron-compatibility";
import {
  NEMOTRONH_LAYER_PREFIXES,
  SUPER_CANONICAL_MODEL_PATH,
} from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const modelPath = readArg("--model-path") ?? SUPER_CANONICAL_MODEL_PATH;
  const config = await analyzeNemotronConfig(modelPath);
  const weights = await analyzeNemotronWeights(modelPath);
  const split = simulateNemotronSplit({ modelPath, weightPrefixAnalysis: weights });

  const expectedPrefixCount = (config.num_hidden_layers ?? 0) + 3;
  const passed =
    split.status === "passed"
    && split.proposed_layer_names.length === expectedPrefixCount
    && weights.layer_prefix === NEMOTRONH_LAYER_PREFIXES.layerPrefix;

  const result = {
    phase: "super_airllm_repair_s2_l4_split_plan",
    verdict: passed ? "split_plan_ready" : "split_plan_blocked",
    model_path: modelPath,
    config_analysis: config,
    weight_prefix_analysis: weights,
    split_simulation: split,
    expected_prefix_count: expectedPrefixCount,
    split_writes_performed: false,
    tensor_load_performed: false,
    gpu_use_performed: false,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(passed ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
