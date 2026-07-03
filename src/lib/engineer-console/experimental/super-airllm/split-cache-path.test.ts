import { describe, expect, it } from "vitest";
import {
  auditStorageCandidates,
  readSplitCacheDirFromEnv,
  resolveSplitCachePath,
  validateSplitCacheFilesystem,
} from "./split-cache-path";
import {
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_LEGACY_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_MIN_SPLIT_FREE_GIB,
  SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
} from "./constants";

describe("Super AirLLM split cache path resolver", () => {
  it("reads env var with S3 default fallback", () => {
    expect(readSplitCacheDirFromEnv({})).toBe(SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR);
    expect(readSplitCacheDirFromEnv({ [SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR]: SUPER_AIRLLM_LEGACY_SPLIT_CACHE_DIR })).toBe(
      SUPER_AIRLLM_LEGACY_SPLIT_CACHE_DIR,
    );
  });

  it("returns blocked when cache path missing", async () => {
    const result = await resolveSplitCachePath({
      env: { [SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR]: "/tmp/missing-super-airllm-splits-xyz" },
      create: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.blocked_reasons).toContain("SPLIT_CACHE_PATH_MISSING");
    expect(result.materialization_allowed).toBe(false);
  });

  it("blocks NTFS canonical storage when filesystem type is detected", async () => {
    const result = await validateSplitCacheFilesystem("/mnt/large-storage/models");
    if (!result.filesystem_type) {
      expect(result.ok).toBe(false);
      return;
    }
    expect(result.ok).toBe(false);
  });

  it("storage audit marks recommended ext4 path when sufficient", async () => {
    const rows = await auditStorageCandidates();
    const recommended = rows.find((entry) => entry.path === SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR);
    expect(recommended).toBeDefined();
    expect(recommended?.split_output_safe).toBe(true);
    if ((recommended?.free_bytes ?? 0) >= SUPER_AIRLLM_MIN_SPLIT_FREE_GIB * 1024 ** 3) {
      expect(recommended?.materialization_allowed).toBe(true);
    }
  });
});
