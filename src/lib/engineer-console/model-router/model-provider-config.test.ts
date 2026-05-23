import { afterEach, describe, expect, it } from "vitest";
import {
  getModelProviderConfig,
  getPublicModelProviderInfo,
  ModelProviderConfigError,
  validateModelProviderConfig,
} from "./model-provider-config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("model-provider-config", () => {
  it("defaults to mock provider", () => {
    delete process.env.ENGINEER_CONSOLE_MODEL_PROVIDER;
    const config = getModelProviderConfig();
    expect(config.provider).toBe("mock");
  });

  it("selects kimi when env set", () => {
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "test-key";
    const config = getModelProviderConfig();
    expect(config.provider).toBe("kimi");
    expect(config.kimiBaseUrl).toContain("moonshot.ai");
  });

  it("throws when kimi selected without API key", () => {
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "kimi";
    delete process.env.KIMI_API_KEY;
    expect(() => validateModelProviderConfig()).toThrow(ModelProviderConfigError);
    const info = getPublicModelProviderInfo();
    expect(info.providerStatus).toBe("misconfigured");
    expect(info.statusMessage).toContain("KIMI_API_KEY");
    expect(info.statusMessage).not.toContain("sk-");
  });

  it("does not include API key in error messages", () => {
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "sk-super-secret-key-value";
    delete process.env.KIMI_API_KEY;
    try {
      validateModelProviderConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("sk-super-secret");
    }
  });
});
