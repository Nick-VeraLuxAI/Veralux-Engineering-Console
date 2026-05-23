import {
  getModelProviderConfig,
  validateModelProviderConfig,
  type ModelProviderConfig,
} from "./model-provider-config";
import { ModelProviderConfigError } from "./model-provider-config";
import type { ModelProvider } from "./model-provider-types";
import { MockModelProvider } from "./providers/mock-model-provider";
import { KimiModelProvider, type FetchFn } from "./providers/kimi-model-provider";

const providers = new Map<string, ModelProvider>();

function registerDefaults(): void {
  const mock = new MockModelProvider();
  providers.set(mock.name, mock);
}

registerDefaults();

export function registerModelProvider(provider: ModelProvider): void {
  providers.set(provider.name, provider);
}

export function clearRegisteredProvidersForTests(): void {
  providers.clear();
  registerDefaults();
}

export function getModelProvider(name: string): ModelProvider | null {
  return providers.get(name) ?? null;
}

export function listModelProviders(): string[] {
  return [...providers.keys()];
}

export function getDefaultModelProvider(): ModelProvider {
  return providers.get("mock") ?? new MockModelProvider();
}

export function resolveConfiguredModelProvider(
  config: ModelProviderConfig = getModelProviderConfig(),
  fetchFn?: FetchFn,
): ModelProvider {
  validateModelProviderConfig(config);

  if (config.provider === "mock") {
    return getModelProvider("mock") ?? new MockModelProvider();
  }

  if (config.provider === "kimi") {
    const cached = providers.get("kimi");
    if (cached && !fetchFn) {
      return cached;
    }
    const kimi = new KimiModelProvider(config, fetchFn);
    if (!fetchFn) {
      providers.set("kimi", kimi);
    }
    return kimi;
  }

  throw new ModelProviderConfigError(
    "UNKNOWN_PROVIDER",
    `No provider registered for: ${config.provider}`,
  );
}

export function resolveModelProviderByName(
  name: string,
  config?: ModelProviderConfig,
  fetchFn?: FetchFn,
): ModelProvider {
  const cfg = config ?? getModelProviderConfig();

  if (name === "mock") {
    return getModelProvider("mock") ?? new MockModelProvider();
  }

  if (name === "kimi") {
    if (cfg.provider !== "kimi") {
      validateModelProviderConfig({ ...cfg, provider: "kimi" });
    }
    return new KimiModelProvider({ ...cfg, provider: "kimi" }, fetchFn);
  }

  const registered = getModelProvider(name);
  if (registered) {
    return registered;
  }

  throw new ModelProviderConfigError(
    "UNKNOWN_PROVIDER",
    `Unknown model provider: ${name}`,
  );
}
