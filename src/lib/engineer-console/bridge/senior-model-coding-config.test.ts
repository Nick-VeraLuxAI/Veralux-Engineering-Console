import { describe, expect, it } from "vitest";
import { getLocalModelCodingConfig } from "./local-model-coding-config";
import {
  getSeniorModelCodingConfig,
  seniorModelConfigCollidesWithLocalWorker,
} from "./senior-model-coding-config";

describe("senior-model-coding-config", () => {
  it("reads only the senior env namespace without tier fallbacks", () => {
    const config = getSeniorModelCodingConfig({
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:8080/v1",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "qwen-coder-32b-test",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MAX_REPAIR_ATTEMPTS: "3",
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL: "Nemotron-Nano-30B-A3B-NVFP4",
      VERALUX_MODEL_TIER_FAST_URL: "http://127.0.0.1:9999/v1",
      VERALUX_MODEL_TIER_SENIOR_MODEL: "should-not-be-used",
    });

    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(config.model).toBe("qwen-coder-32b-test");
    expect(config.maxRepairAttempts).toBe(3);
  });

  it("defaults senior base URL to :8080 and leaves model unset when not configured", () => {
    const config = getSeniorModelCodingConfig({});
    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(config.model).toBeNull();
    expect(config.maxRepairAttempts).toBe(2);
  });

  it("detects endpoint/model collision with the local default worker", () => {
    const local = getLocalModelCodingConfig({
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED: "true",
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL: "Nemotron-Nano-30B-A3B-NVFP4",
    });
    const distinctSenior = getSeniorModelCodingConfig({
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:8080/v1",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "qwen-coder-32b-test",
    });
    const collidingSenior = getSeniorModelCodingConfig({
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
      ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "Nemotron-Nano-30B-A3B-NVFP4",
    });

    expect(seniorModelConfigCollidesWithLocalWorker(distinctSenior, local)).toBe(false);
    expect(seniorModelConfigCollidesWithLocalWorker(collidingSenior, local)).toBe(true);
  });
});
