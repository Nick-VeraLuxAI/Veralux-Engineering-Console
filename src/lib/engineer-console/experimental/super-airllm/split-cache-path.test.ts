import { describe, expect, it } from "vitest";
import {
  readSplitCacheDirFromEnv,
  resolveSplitCachePath,
  validateSplitCacheFilesystem,
} from "./split-cache-path";
import {
  SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES,
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
} from "./constants";

describe("Super AirLLM split cache path resolver", () => {
  it("reads env var with default fallback", () => {
    expect(readSplitCacheDirFromEnv({})).toBe(SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR);
    expect(readSplitCacheDirFromEnv({ [SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR]: "/tmp/custom" })).toBe("/tmp/custom");
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
      expect(result.diagnostics).toContain("SPLIT_CACHE_FSTYPE_UNKNOWN");
      return;
    }
    expect(SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES).toContain(result.filesystem_type);
    expect(result.ok).toBe(false);
  });

  it("dry-run preflight script path stays blocked without create flag", async () => {
    const result = await resolveSplitCachePath({ create: false });
    if (result.status === "ready") {
      expect(result.materialization_allowed).toBe(true);
      expect(result.filesystem_type).not.toBe("ntfs3");
      return;
    }
    expect(result.status).toBe("blocked");
  });
});
