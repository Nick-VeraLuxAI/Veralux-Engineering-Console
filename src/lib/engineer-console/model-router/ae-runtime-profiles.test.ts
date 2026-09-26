import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { getSeniorModelCodingConfig } from "../bridge/senior-model-coding-config";
import {
  AE_DEFAULT_WORKER_PROFILE_ID,
  AE_RUNTIME_PROFILE_ENV,
  AE_RUNTIME_PROFILE_IDS,
  AE_RUNTIME_PROFILE_SELECTION,
  AE_RUNTIME_PROFILES,
  AE_RUNTIME_PROFILES_V1_ID,
  AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP,
  DEEPSEEK_SENIOR_PROFILE,
  GLM_IS_ACTIVE_AE_RUNTIME_PROFILE,
  GLM_PARKED_INVENTORY,
  NANO_FAITHFUL_PROFILE,
  NANO_FAST_PROFILE,
  getAeRuntimeProfile,
  getDefaultAeWorkerProfile,
  listAeRuntimeProfiles,
  listAeWorkerProfiles,
  resolveAeRuntimeProfile,
  resolveAeWorkerProfile,
} from "./ae-runtime-profiles";

describe("ae-runtime-profiles-v1", () => {
  it("registers nano-faithful as the default AE worker profile", () => {
    expect(AE_RUNTIME_PROFILES_V1_ID).toBe("ae-runtime-profiles-v1");
    expect(AE_DEFAULT_WORKER_PROFILE_ID).toBe("nano-faithful");
    expect(getDefaultAeWorkerProfile()).toEqual(NANO_FAITHFUL_PROFILE);
    expect(NANO_FAITHFUL_PROFILE.isDefault).toBe(true);
    expect(NANO_FAITHFUL_PROFILE.enabledByDefault).toBe(true);
    expect(NANO_FAITHFUL_PROFILE.openaiBaseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(NANO_FAITHFUL_PROFILE.model).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(NANO_FAITHFUL_PROFILE.maxModelLen).toBe(262144);
    expect(NANO_FAITHFUL_PROFILE.avgOutputTps).toBe(279.83);
    expect(NANO_FAITHFUL_PROFILE.role).toBe("long-context / diagnostic / FAITHFUL worker");
    expect(resolveAeWorkerProfile().profile.id).toBe("nano-faithful");
    expect(resolveAeRuntimeProfile().profile.id).toBe("nano-faithful");
  });

  it("registers nano-fast as the short-context worker profile", () => {
    const profile = getAeRuntimeProfile("nano-fast");
    expect(profile).toEqual(NANO_FAST_PROFILE);
    expect(profile.isDefault).toBe(false);
    expect(profile.enabledByDefault).toBe(true);
    expect(profile.kind).toBe("worker");
    expect(profile.openaiBaseUrl).toBe("http://127.0.0.1:8081/v1");
    expect(profile.model).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(profile.maxModelLen).toBe(8192);
    expect(profile.avgOutputTps).toBe(278.82);
    expect(profile.role).toBe("short-context fast implementation worker");
    expect(listAeWorkerProfiles().map((item) => item.id)).toEqual(["nano-fast", "nano-faithful"]);
    expect(getDefaultAeWorkerProfile().id).not.toBe("nano-fast");
  });

  it("registers deepseek-senior as disabled / on-demand and not concurrent with Nano", () => {
    const profile = getAeRuntimeProfile("deepseek-senior");
    expect(profile).toEqual(DEEPSEEK_SENIOR_PROFILE);
    expect(profile.kind).toBe("senior");
    expect(profile.isDefault).toBe(false);
    expect(profile.enabledByDefault).toBe(false);
    expect(profile.autoServe).toBe(false);
    expect(profile.concurrentWithNano).toBe(false);
    expect(profile.requiresManualServe).toBe(true);
    expect(profile.status).toBe("on_demand");
    expect(profile.openaiBaseUrl).toBe("http://127.0.0.1:1919/v1");
    expect(profile.model).toBe("deepseek-v4-flash-ftw-tp1");
    expect(profile.checkpoint).toBe("/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw");
    expect(profile.maxModelLen).toBe(32768);
    expect(profile.avgOutputTps).toBe(26.6);
    expect(listAeWorkerProfiles().some((item) => item.id === "deepseek-senior")).toBe(false);
  });

  it("does not register GLM as an active AE runtime profile", () => {
    expect(GLM_IS_ACTIVE_AE_RUNTIME_PROFILE).toBe(false);
    expect(AE_RUNTIME_PROFILE_IDS).not.toContain("glm");
    expect(listAeRuntimeProfiles().some((profile) => profile.id.includes("glm"))).toBe(false);
    expect(
      listAeRuntimeProfiles().some(
        (profile) =>
          profile.checkpoint === GLM_PARKED_INVENTORY.rawPath
          || profile.checkpoint === GLM_PARKED_INVENTORY.ftwPath,
      ),
    ).toBe(false);
    expect(GLM_PARKED_INVENTORY.status).toBe("inactive_parked");
    expect(() => getAeRuntimeProfile("glm")).toThrow(/Unknown AE runtime profile/);
  });

  it("resolves profiles by ID without applying them to the live worker", () => {
    const explicit = resolveAeRuntimeProfile({ profileId: "nano-faithful" });
    expect(explicit.profile.id).toBe("nano-faithful");
    expect(explicit.source).toBe("explicit_id");
    expect(explicit.appliedToLiveWorker).toBe(false);

    const fromEnv = resolveAeRuntimeProfile({
      env: { [AE_RUNTIME_PROFILE_ENV]: "deepseek-senior" },
    });
    expect(fromEnv.profile.id).toBe("deepseek-senior");
    expect(fromEnv.source).toBe("env_profile");
    expect(fromEnv.appliedToLiveWorker).toBe(false);
    expect(fromEnv.profile.autoServe).toBe(false);
    expect(fromEnv.profile.enabledByDefault).toBe(false);
  });

  it("maps the current env worker URL and never uses DeepSeek as the worker", () => {
    expect(
      resolveAeWorkerProfile({
        env: { ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8082/v1" },
      }).profile.id,
    ).toBe("nano-faithful");

    const seniorRequestedAsWorker = resolveAeWorkerProfile({
      profileId: "deepseek-senior",
      env: { ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1" },
    });
    expect(seniorRequestedAsWorker.profile.id).toBe("nano-fast");
    expect(seniorRequestedAsWorker.rejectedSeniorAsWorker).toBe(true);
    expect(seniorRequestedAsWorker.appliedToLiveWorker).toBe(false);

    const seniorUrlAsWorker = resolveAeWorkerProfile({
      env: { ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1" },
    });
    expect(seniorUrlAsWorker.profile.id).toBe("nano-faithful");
    expect(seniorUrlAsWorker.source).toBe("default_worker");
  });

  it("defaults the coding worker URL to FAITHFUL 8082 and leaves senior disabled", () => {
    const local = getLocalModelCodingConfig({});
    expect(local.baseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(local.model).toBe("Nemotron-Nano-30B-A3B-NVFP4");

    const senior = getSeniorModelCodingConfig({});
    expect(senior.enabled).toBe(false);

    expect(AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP).toBe(false);
    expect(AE_RUNTIME_PROFILES["nano-faithful"].openaiBaseUrl).toBe(local.baseUrl);
    expect(AE_RUNTIME_PROFILE_SELECTION["nano-fast"]).toMatch(/under 8k/i);
    expect(AE_RUNTIME_PROFILE_SELECTION["nano-faithful"]).toMatch(/>8k|more than 8k/i);
    expect(AE_RUNTIME_PROFILE_SELECTION["deepseek-senior"]).toMatch(/PR-readiness/i);
  });

  it("is not imported by the live AE worker path", () => {
    const root = path.join(__dirname, "..", "autonomous-engineer");
    const loop = readFileSync(path.join(root, "loop.ts"), "utf8");
    const workerClient = readFileSync(path.join(root, "worker-client.ts"), "utf8");
    const workerRoute = readFileSync(path.join(root, "worker-route.ts"), "utf8");
    expect(loop).not.toMatch(/ae-runtime-profiles/);
    expect(workerClient).not.toMatch(/ae-runtime-profiles/);
    expect(workerRoute).not.toMatch(/ae-runtime-profiles/);
  });
});
