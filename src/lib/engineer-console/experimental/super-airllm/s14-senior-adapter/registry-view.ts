/** Gated registry facts for Super senior runtime (truthful; never default). */

import {
  S14_CONFIGURED_MAX_NEW_TOKENS,
  S14_EXECUTION_MODE,
  S14_RUNTIME_ID,
  S14_VERIFIED_MAX_NEW_TOKENS,
} from "./types";

export type GatedSeniorRegistryView = {
  model_id: typeof S14_RUNTIME_ID;
  health_state: "candidate" | "gated_available";
  defaultRoute: false;
  automaticSelection: false;
  explicitApprovalRequired: true;
  localOnly: true;
  nativeFp8KernelProven: false;
  executionMode: typeof S14_EXECUTION_MODE;
  maxConcurrentRequests: 1;
  s13BaseUrlRequired: true;
  consoleNanoInterruptionRequired: true;
  /** Inclusive supported range for bounded long-form. */
  maxNewTokens: readonly [1, typeof S14_CONFIGURED_MAX_NEW_TOKENS];
  configuredMaxNewTokens: typeof S14_CONFIGURED_MAX_NEW_TOKENS;
  verifiedMaxNewTokens: typeof S14_VERIFIED_MAX_NEW_TOKENS;
  generationStrategy: "full_prefix_recomputation";
  kvCacheClaimed: false;
  tokenStreaming: false;
  productionReady: false;
  veraluxRoutingEnabled: false;
};

export const GATED_SENIOR_REGISTRY_BEFORE: GatedSeniorRegistryView = {
  model_id: S14_RUNTIME_ID,
  health_state: "candidate",
  defaultRoute: false,
  automaticSelection: false,
  explicitApprovalRequired: true,
  localOnly: true,
  nativeFp8KernelProven: false,
  executionMode: S14_EXECUTION_MODE,
  maxConcurrentRequests: 1,
  s13BaseUrlRequired: true,
  consoleNanoInterruptionRequired: true,
  maxNewTokens: [1, S14_CONFIGURED_MAX_NEW_TOKENS],
  configuredMaxNewTokens: S14_CONFIGURED_MAX_NEW_TOKENS,
  verifiedMaxNewTokens: S14_VERIFIED_MAX_NEW_TOKENS,
  generationStrategy: "full_prefix_recomputation",
  kvCacheClaimed: false,
  tokenStreaming: false,
  productionReady: false,
  veraluxRoutingEnabled: false,
};

export const GATED_SENIOR_REGISTRY_AFTER: GatedSeniorRegistryView = {
  ...GATED_SENIOR_REGISTRY_BEFORE,
  health_state: "gated_available",
};

export function assertNoDefaultInvariants(view: GatedSeniorRegistryView): void {
  if (view.defaultRoute !== false) throw new Error("defaultRoute_must_be_false");
  if (view.automaticSelection !== false) throw new Error("automaticSelection_must_be_false");
  if (view.explicitApprovalRequired !== true) throw new Error("explicitApprovalRequired_must_be_true");
  if (view.localOnly !== true) throw new Error("localOnly_must_be_true");
  if (view.nativeFp8KernelProven !== false) throw new Error("nativeFp8_must_be_unproven");
  if (view.maxConcurrentRequests !== 1) throw new Error("maxConcurrentRequests_must_be_1");
  if (view.executionMode !== S14_EXECUTION_MODE) throw new Error("executionMode_mismatch");
  if (view.kvCacheClaimed !== false) throw new Error("kv_cache_must_not_be_claimed");
  if (view.configuredMaxNewTokens !== S14_CONFIGURED_MAX_NEW_TOKENS) {
    throw new Error("configured_max_mismatch");
  }
}
