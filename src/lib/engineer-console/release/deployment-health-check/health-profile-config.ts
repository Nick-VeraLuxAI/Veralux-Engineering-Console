import type {
  HealthCheckProfileConfig,
  HealthCheckProfilePublicMetadata,
  HealthCheckProfileType,
} from "./deployment-health-check-types";
import {
  HEALTH_CHECK_PROFILE_TYPES,
  DeploymentHealthCheckError,
} from "./deployment-health-check-types";

const DEFAULT_TIMEOUT_MS = 10_000;

function parseHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function assertProfileShape(raw: unknown): HealthCheckProfileConfig {
  if (!raw || typeof raw !== "object") {
    throw new DeploymentHealthCheckError("Invalid health check profile entry.");
  }
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const environmentName = typeof p.environmentName === "string" ? p.environmentName.trim() : "";
  const type = p.type as HealthCheckProfileType;
  const url = typeof p.url === "string" ? p.url.trim() : "";
  const expectedStatus =
    typeof p.expectedStatus === "number" ? Math.trunc(p.expectedStatus) : 200;
  const allowed = p.allowed === true;

  if (!name || !environmentName) {
    throw new DeploymentHealthCheckError("Health profile requires name and environmentName.");
  }
  if (!HEALTH_CHECK_PROFILE_TYPES.includes(type)) {
    throw new DeploymentHealthCheckError(`Unsupported health profile type: ${String(p.type)}`);
  }
  if (!url) {
    throw new DeploymentHealthCheckError("Health profile requires url.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DeploymentHealthCheckError("Health profile url is not valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DeploymentHealthCheckError("Health profile url must use http or https.");
  }

  return normalizeHealthProfile({
    name,
    environmentName,
    type,
    url,
    expectedStatus,
    allowed,
    timeoutMs:
      typeof p.timeoutMs === "number" && p.timeoutMs > 0
        ? Math.min(p.timeoutMs, 120_000)
        : DEFAULT_TIMEOUT_MS,
  });
}

function normalizeHealthProfile(profile: HealthCheckProfileConfig): HealthCheckProfileConfig {
  return {
    ...profile,
    allowed: profile.allowed === true && profile.type === "http",
  };
}

function loadProfilesFromEnv(): HealthCheckProfileConfig[] {
  const json = process.env.ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON?.trim();
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DeploymentHealthCheckError(
      "ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON is not valid JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DeploymentHealthCheckError(
      "ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON must be a JSON array.",
    );
  }
  return parsed.map(assertProfileShape);
}

let testProfilesOverride: HealthCheckProfileConfig[] | null = null;

export function setHealthCheckProfilesForTests(profiles: HealthCheckProfileConfig[] | null): void {
  testProfilesOverride = profiles;
}

export function listHealthCheckProfiles(): HealthCheckProfileConfig[] {
  const profiles = testProfilesOverride ? [...testProfilesOverride] : loadProfilesFromEnv();
  return profiles.map(normalizeHealthProfile);
}

export function getHealthCheckProfileByName(name: string): HealthCheckProfileConfig | null {
  return listHealthCheckProfiles().find((p) => p.name === name) ?? null;
}

export function resolveExecutableHealthProfile(profileName: string): HealthCheckProfileConfig {
  const profile = getHealthCheckProfileByName(profileName.trim());
  if (!profile) {
    throw new DeploymentHealthCheckError(`Health profile not found: ${profileName}`);
  }
  if (!profile.allowed) {
    throw new DeploymentHealthCheckError(`Health profile is disabled: ${profileName}`);
  }
  if (profile.type !== "http") {
    throw new DeploymentHealthCheckError(`Health profile type is not supported: ${profile.type}`);
  }
  return profile;
}

export function listPublicHealthCheckProfiles(): HealthCheckProfilePublicMetadata[] {
  return listHealthCheckProfiles().map((p) => ({
    name: p.name,
    environmentName: p.environmentName,
    type: p.type,
    enabled: p.allowed,
    hostname: parseHostname(p.url),
  }));
}

export function listPublicHealthCheckProfilesForEnvironment(
  environmentName: string,
): HealthCheckProfilePublicMetadata[] {
  return listPublicHealthCheckProfiles().filter((p) => p.environmentName === environmentName);
}
