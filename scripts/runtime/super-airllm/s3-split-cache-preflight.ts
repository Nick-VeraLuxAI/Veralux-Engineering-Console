import { access } from "fs/promises";
import { resolveSplitCachePath } from "../../../src/lib/engineer-console/experimental/super-airllm/split-cache-path";
import {
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
  readSuperModelPathFromEnv,
} from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const create = process.argv.includes("--create-cache-dir");
  const modelPath = readArg("--model-path") ?? readSuperModelPathFromEnv();
  const cache = await resolveSplitCachePath({ create });

  let modelPathExists = false;
  try {
    await access(modelPath);
    modelPathExists = true;
  } catch {
    modelPathExists = false;
  }

  const passed = cache.status === "ready" && modelPathExists;
  const result = {
    phase: "super_airllm_repair_s2_l4_split_cache_preflight",
    verdict: passed ? "split_cache_ready" : "split_cache_blocked",
    model_path: modelPath,
    model_path_exists: modelPathExists,
    split_cache_env_var: SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
    default_split_cache_dir: SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
    split_cache: cache,
    split_materialization_performed: false,
    dry_run: !process.argv.includes("--allow-split-materialize"),
  };
  process.exit(passed ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
