import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_GPU_CONSTRAINT,
  DEEPSEEK_SENIOR,
  ESCALATION_RULES,
  GLM_PARKED,
  LOCAL_MODEL_RUNTIME_STRATEGY_ID,
  NANO_LONG_WORKER,
  NANO_RETUNE_NEEDED,
  NANO_SHORT_WORKER,
  RECOMMENDED_OPERATOR_ENV,
  TP2_ACTIVE,
  VALIDATED_PROBE_PATHS,
  localModelRuntimeStrategySummary,
} from "./local-model-runtime-strategy";

describe("local-model-runtime-strategy", () => {
  it("records the validated Nano / DeepSeek / GLM role split without enabling auto-serve", () => {
    const summary = localModelRuntimeStrategySummary();

    expect(summary.id).toBe(LOCAL_MODEL_RUNTIME_STRATEGY_ID);
    expect(NANO_SHORT_WORKER.openaiBaseUrl).toBe("http://127.0.0.1:8081/v1");
    expect(NANO_SHORT_WORKER.maxModelLen).toBe(8192);
    expect(NANO_LONG_WORKER.openaiBaseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(NANO_LONG_WORKER.maxModelLen).toBe(262144);
    expect(DEEPSEEK_SENIOR.port).toBe(1919);
    expect(DEEPSEEK_SENIOR.tensorParallelSize).toBe(1);
    expect(DEEPSEEK_SENIOR.onDemand).toBe(true);
    expect(DEEPSEEK_SENIOR.autoServe).toBe(false);
    expect(DEEPSEEK_SENIOR.concurrentWithNano).toBe(false);
    expect(GLM_PARKED.status).toBe("inactive_parked");
    expect(GLM_PARKED.deleteForbidden).toBe(true);
    expect(TP2_ACTIVE).toBe(false);
    expect(NANO_RETUNE_NEEDED).toBe(false);
    expect(summary.deepseekOnDemand).toBe(true);
  });

  it("states the GPU constraint that DeepSeek cannot run with current Nano containers", () => {
    expect(DEEPSEEK_GPU_CONSTRAINT.nanoOccupiesBothGpus).toBe(true);
    expect(DEEPSEEK_GPU_CONSTRAINT.deepseekUsesGpu0Tp1).toBe(true);
    expect(DEEPSEEK_GPU_CONSTRAINT.concurrentServeSupported).toBe(false);
    expect(DEEPSEEK_GPU_CONSTRAINT.note).toMatch(/on-demand/i);
  });

  it("keeps recommended senior env opt-in and points at the validated probes", () => {
    expect(RECOMMENDED_OPERATOR_ENV.seniorEnabledDefault).toBe(false);
    expect(RECOMMENDED_OPERATOR_ENV.seniorBaseUrl).toBe("http://127.0.0.1:1919/v1");
    expect(VALIDATED_PROBE_PATHS.deepseekFtwVerify).toContain("deepseek-v4-freetoken-ftw-verify");
    expect(VALIDATED_PROBE_PATHS.nanoTpsBenchmark).toContain("nano-tps-benchmark");
    expect(ESCALATION_RULES.length).toBeGreaterThanOrEqual(7);
  });
});
