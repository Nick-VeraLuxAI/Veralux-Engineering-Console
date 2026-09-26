/**
 * AE Runtime Profiles V1 — governed switchboard for local model roles.
 * Source of truth: docs/source-of-truth/ae-runtime-profiles-v1.md
 *
 * This module can resolve a profile by ID. It is not imported by the AE loop,
 * worker-client, or worker-route. Do not use it to auto-start DeepSeek, change
 * the live FAITHFUL 8082 default, or replace ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*.
 */

import { normalizeLocalModelCodingBaseUrl } from "../bridge/local-model-coding-config";
import {
  DEEPSEEK_SENIOR,
  GLM_PARKED,
  NANO_LONG_WORKER,
  NANO_SHORT_WORKER,
} from "./local-model-runtime-strategy";

export const AE_RUNTIME_PROFILES_V1_ID = "ae-runtime-profiles-v1" as const;

/** Future env hook. Resolver understands it; AE loop does not consume it in V1. */
export const AE_RUNTIME_PROFILE_ENV = "ENGINEER_CONSOLE_AE_RUNTIME_PROFILE" as const;

export const AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP = false;

export const AE_RUNTIME_PROFILE_IDS = ["nano-fast", "nano-faithful", "deepseek-senior"] as const;
export type AeRuntimeProfileId = (typeof AE_RUNTIME_PROFILE_IDS)[number];

export const AE_DEFAULT_WORKER_PROFILE_ID = "nano-faithful" as const satisfies AeRuntimeProfileId;

export type AeRuntimeProfileKind = "worker" | "senior";
export type AeRuntimeProfileStatus = "ready" | "on_demand";

export type AeRuntimeProfile = {
  id: AeRuntimeProfileId;
  kind: AeRuntimeProfileKind;
  role: string;
  openaiBaseUrl: string;
  model: string;
  maxModelLen: number;
  avgOutputTps: number;
  isDefault: boolean;
  enabledByDefault: boolean;
  autoServe: boolean;
  concurrentWithNano: boolean;
  requiresManualServe: boolean;
  checkpoint: string | null;
  status: AeRuntimeProfileStatus;
};

export type AeWorkerRuntimeProfile = AeRuntimeProfile & { kind: "worker" };

export type AeRuntimeProfileResolveSource =
  | "explicit_id"
  | "env_profile"
  | "env_worker_url"
  | "default_worker";

export type AeRuntimeProfileResolveInput = {
  profileId?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type AeRuntimeProfileResolveResult = {
  profile: AeRuntimeProfile;
  source: AeRuntimeProfileResolveSource;
  requestedId: AeRuntimeProfileId | null;
  appliedToLiveWorker: false;
  rejectedSeniorAsWorker: boolean;
};

export type AeWorkerProfileResolveResult = AeRuntimeProfileResolveResult & {
  profile: AeWorkerRuntimeProfile;
};

export const AE_RUNTIME_PROFILE_SELECTION = {
  "nano-fast": "Normal small implementation loops, short-context edits, and worker runs that stay under 8k.",
  "nano-faithful": "Long-context / FAITHFUL implementation or diagnostic worker runs that need more than 8k.",
  "deepseek-senior":
    "Architecture, failed QC, repair-loop exhaustion, and PR-readiness review. Manual FreeToken on 1919 only.",
} as const satisfies Record<AeRuntimeProfileId, string>;

export const NANO_FAST_PROFILE = {
  id: "nano-fast",
  kind: "worker",
  role: "short-context fast implementation worker",
  openaiBaseUrl: NANO_SHORT_WORKER.openaiBaseUrl,
  model: NANO_SHORT_WORKER.model,
  maxModelLen: NANO_SHORT_WORKER.maxModelLen,
  avgOutputTps: NANO_SHORT_WORKER.avgOutputTokPerSec,
  isDefault: false,
  enabledByDefault: true,
  autoServe: false,
  concurrentWithNano: true,
  requiresManualServe: false,
  checkpoint: null,
  status: "ready",
} as const satisfies AeWorkerRuntimeProfile;

export const NANO_FAITHFUL_PROFILE = {
  id: "nano-faithful",
  kind: "worker",
  role: "long-context / diagnostic / FAITHFUL worker",
  openaiBaseUrl: NANO_LONG_WORKER.openaiBaseUrl,
  model: NANO_LONG_WORKER.model,
  maxModelLen: NANO_LONG_WORKER.maxModelLen,
  avgOutputTps: NANO_LONG_WORKER.avgOutputTokPerSec,
  isDefault: true,
  enabledByDefault: true,
  autoServe: false,
  concurrentWithNano: true,
  requiresManualServe: false,
  checkpoint: null,
  status: "ready",
} as const satisfies AeWorkerRuntimeProfile;

export const DEEPSEEK_SENIOR_PROFILE = {
  id: "deepseek-senior",
  kind: "senior",
  role: "senior architect / reviewer / failed-run diagnostician",
  openaiBaseUrl: DEEPSEEK_SENIOR.openaiBaseUrl,
  model: DEEPSEEK_SENIOR.servedModelName,
  maxModelLen: DEEPSEEK_SENIOR.contextProven,
  avgOutputTps: DEEPSEEK_SENIOR.decodeTokPerSec,
  isDefault: false,
  enabledByDefault: false,
  autoServe: false,
  concurrentWithNano: false,
  requiresManualServe: true,
  checkpoint: DEEPSEEK_SENIOR.ftwPath,
  status: "on_demand",
} as const satisfies AeRuntimeProfile;

export const AE_RUNTIME_PROFILES = {
  "nano-fast": NANO_FAST_PROFILE,
  "nano-faithful": NANO_FAITHFUL_PROFILE,
  "deepseek-senior": DEEPSEEK_SENIOR_PROFILE,
} as const satisfies Record<AeRuntimeProfileId, AeRuntimeProfile>;

/** GLM is parked inventory, not an AE runtime profile. */
export const GLM_IS_ACTIVE_AE_RUNTIME_PROFILE = false;
export const GLM_PARKED_INVENTORY = GLM_PARKED;

export function isAeRuntimeProfileId(value: string): value is AeRuntimeProfileId {
  return (AE_RUNTIME_PROFILE_IDS as readonly string[]).includes(value);
}

export function getAeRuntimeProfile(id: string): AeRuntimeProfile {
  if (!isAeRuntimeProfileId(id)) {
    throw new Error(
      `Unknown AE runtime profile: ${id}. Valid ids: ${AE_RUNTIME_PROFILE_IDS.join(", ")}.`,
    );
  }
  return AE_RUNTIME_PROFILES[id];
}

export function listAeRuntimeProfiles(): AeRuntimeProfile[] {
  return AE_RUNTIME_PROFILE_IDS.map((id) => AE_RUNTIME_PROFILES[id]);
}

export function listAeWorkerProfiles(): AeWorkerRuntimeProfile[] {
  return listAeRuntimeProfiles().filter((profile): profile is AeWorkerRuntimeProfile => profile.kind === "worker");
}

export function getDefaultAeWorkerProfile(): AeWorkerRuntimeProfile {
  return NANO_FAITHFUL_PROFILE;
}

function requestedProfileId(
  input: AeRuntimeProfileResolveInput,
): { id: AeRuntimeProfileId | null; source: "explicit_id" | "env_profile" | null } {
  const explicit = input.profileId?.trim();
  if (explicit) {
    return { id: getAeRuntimeProfile(explicit).id, source: "explicit_id" };
  }

  const fromEnv = input.env?.[AE_RUNTIME_PROFILE_ENV]?.trim();
  if (fromEnv) {
    return { id: getAeRuntimeProfile(fromEnv).id, source: "env_profile" };
  }

  return { id: null, source: null };
}

function matchProfileByBaseUrl(url: string): AeRuntimeProfile | null {
  const normalized = normalizeLocalModelCodingBaseUrl(url);
  return listAeRuntimeProfiles().find(
    (profile) => normalizeLocalModelCodingBaseUrl(profile.openaiBaseUrl) === normalized,
  ) ?? null;
}

function workerProfileFromEnvUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined,
): { profile: AeWorkerRuntimeProfile; source: "env_worker_url" | "default_worker" } {
  const url = env?.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL?.trim();
  if (!url) {
    return { profile: getDefaultAeWorkerProfile(), source: "default_worker" };
  }

  const matched = matchProfileByBaseUrl(url);
  if (matched?.kind === "worker") {
    return { profile: matched, source: "env_worker_url" };
  }

  return { profile: getDefaultAeWorkerProfile(), source: "default_worker" };
}

/**
 * Resolve any registered profile by explicit ID, optional env ID, or worker URL.
 * Lookup only — does not start models or change the live AE worker.
 */
export function resolveAeRuntimeProfile(
  input: AeRuntimeProfileResolveInput = {},
): AeRuntimeProfileResolveResult {
  const requested = requestedProfileId(input);
  if (requested.id && requested.source) {
    return {
      profile: AE_RUNTIME_PROFILES[requested.id],
      source: requested.source,
      requestedId: requested.id,
      appliedToLiveWorker: false,
      rejectedSeniorAsWorker: false,
    };
  }

  const fromUrl = workerProfileFromEnvUrl(input.env);
  return {
    profile: fromUrl.profile,
    source: fromUrl.source,
    requestedId: null,
    appliedToLiveWorker: false,
    rejectedSeniorAsWorker: false,
  };
}

/**
 * Resolve the worker profile only. Senior IDs are never returned as the worker.
 * Current env URL behavior stays the default when no worker profile is requested.
 */
export function resolveAeWorkerProfile(
  input: AeRuntimeProfileResolveInput = {},
): AeWorkerProfileResolveResult {
  const requested = requestedProfileId(input);
  if (requested.id && requested.source) {
    const requestedProfile = AE_RUNTIME_PROFILES[requested.id];
    if (requestedProfile.kind === "worker") {
      return {
        profile: requestedProfile,
        source: requested.source,
        requestedId: requested.id,
        appliedToLiveWorker: false,
        rejectedSeniorAsWorker: false,
      };
    }

    const fallback = workerProfileFromEnvUrl(input.env);
    return {
      profile: fallback.profile,
      source: fallback.source,
      requestedId: requested.id,
      appliedToLiveWorker: false,
      rejectedSeniorAsWorker: true,
    };
  }

  const fromUrl = workerProfileFromEnvUrl(input.env);
  return {
    profile: fromUrl.profile,
    source: fromUrl.source,
    requestedId: null,
    appliedToLiveWorker: false,
    rejectedSeniorAsWorker: false,
  };
}
