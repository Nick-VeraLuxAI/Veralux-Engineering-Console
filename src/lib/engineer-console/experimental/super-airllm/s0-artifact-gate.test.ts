import { describe, expect, it } from "vitest";
import {
  SUPER_ARTIFACT_MISSING,
  SUPER_BLOCKED_MISSING_ARTIFACT,
  SUPER_CANONICAL_MODEL_PATH,
} from "./constants";
import { runSuperS0ArtifactGate } from "./s0-artifact-gate";

describe("Super AirLLM repair S0 artifact gate", () => {
  it("returns artifact_missing for canonical path when weights are absent", async () => {
    const result = await runSuperS0ArtifactGate(
      "/definitely/missing/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
    );

    expect(result.verdict).toBe(SUPER_ARTIFACT_MISSING);
    expect(result.model_load_allowed).toBe(false);
    expect(result.gpu_use_allowed).toBe(false);
    expect(result.artifact.path_exists).toBe(false);
    expect(result.blocked_reasons).toContain("SUPER_S0_MODEL_PATH_MISSING");
    expect(result.artifact.diagnostics[0]).toContain("SUPER_AUDIT_MODEL_PATH_MISSING");
  });

  it("audits canonical operator path without throwing when missing", async () => {
    const result = await runSuperS0ArtifactGate(SUPER_CANONICAL_MODEL_PATH);

    expect(["artifact_present", SUPER_ARTIFACT_MISSING, SUPER_BLOCKED_MISSING_ARTIFACT]).toContain(
      result.verdict,
    );
    expect(result.model_path).toBe(SUPER_CANONICAL_MODEL_PATH);
    expect(result.phase).toBe("super_airllm_repair_s0");
  });
});
