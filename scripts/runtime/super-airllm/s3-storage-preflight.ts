import { auditStorageCandidates, resolveSplitCachePath } from "../../../src/lib/engineer-console/experimental/super-airllm/split-cache-path";
import {
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_CANONICAL_MODEL_PATH,
} from "../../../src/lib/engineer-console/experimental/super-airllm/constants";

async function main(): Promise<void> {
  const create = process.argv.includes("--create-cache-dir");
  const candidates = await auditStorageCandidates();

  let recommendedCheck = await resolveSplitCachePath({ create: false });
  if (recommendedCheck.status === "blocked" && recommendedCheck.blocked_reasons.includes("SPLIT_CACHE_PATH_MISSING") && create) {
    recommendedCheck = await resolveSplitCachePath({ create: true });
  }

  const recommended = candidates.find((entry) => entry.path === SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR);
  const legacy = candidates.find((entry) => entry.role === "legacy_s2_default");

  const result = {
    phase: "super_airllm_repair_s3_storage_preflight",
    verdict: recommendedCheck.materialization_allowed ? "storage_ready" : "storage_blocked",
    canonical_model_path: SUPER_CANONICAL_MODEL_PATH,
    recommended_split_cache_path: SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
    recommended_split_cache_check: recommendedCheck,
    storage_candidates: candidates,
    notes: {
      canonical_raw_ntfs_read_only_ok: true,
      legacy_home_ext4_insufficient: legacy?.materialization_allowed === false,
      recommended_ext4_ready: recommendedCheck.materialization_allowed,
    },
    split_materialization_performed: false,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(recommendedCheck.materialization_allowed ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
