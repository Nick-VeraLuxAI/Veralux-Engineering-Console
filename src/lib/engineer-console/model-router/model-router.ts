import {
  getModelProviderConfig,
  getPublicModelProviderInfo,
} from "./model-provider-config";
import {
  getDefaultModelProvider,
  resolveConfiguredModelProvider,
  resolveModelProviderByName,
} from "./model-provider-registry";
import type {
  GenerateWorkerPlanDraftInput,
  GenerateWorkerPlanDraftResult,
} from "./model-provider-types";
import type { FetchFn } from "./providers/kimi-model-provider";

export { getPublicModelProviderInfo };

export async function generateWorkerPlanDraft(
  input: GenerateWorkerPlanDraftInput,
  providerName?: string,
  fetchFn?: FetchFn,
): Promise<GenerateWorkerPlanDraftResult> {
  const config = getModelProviderConfig();

  const provider = providerName
    ? resolveModelProviderByName(providerName, config, fetchFn)
    : resolveConfiguredModelProvider(config, fetchFn);

  return provider.generateWorkerPlanDraft(input);
}

export function getActiveProviderName(providerOverride?: string): string {
  if (providerOverride) {
    return providerOverride;
  }
  return getModelProviderConfig().provider;
}

export { getDefaultModelProvider };
