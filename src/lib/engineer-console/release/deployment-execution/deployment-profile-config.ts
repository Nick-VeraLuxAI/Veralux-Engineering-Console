import type {
  DeploymentProfileConfig,
  DeploymentProfilePublicMetadata,
  DeploymentProfileStrategy,
} from "./deployment-execution-types";
import { DEPLOYMENT_PROFILE_STRATEGIES, DeploymentExecutionError } from "./deployment-execution-types";

const DEFAULT_TIMEOUT_MS = 300_000;

function assertProfileShape(raw: unknown): DeploymentProfileConfig {
  if (!raw || typeof raw !== "object") {
    throw new DeploymentExecutionError("Invalid deployment profile entry.");
  }
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const environmentName = typeof p.environmentName === "string" ? p.environmentName.trim() : "";
  const strategy = p.strategy as DeploymentProfileStrategy;
  const workingDirectory = typeof p.workingDirectory === "string" ? p.workingDirectory.trim() : "";
  const command = typeof p.command === "string" ? p.command.trim() : "";
  const args = Array.isArray(p.args) ? p.args.map((a) => String(a)) : [];
  if (!name || !environmentName) {
    throw new DeploymentExecutionError("Deployment profile requires name and environmentName.");
  }
  if (!DEPLOYMENT_PROFILE_STRATEGIES.includes(strategy)) {
    throw new DeploymentExecutionError(`Unsupported deployment profile strategy: ${String(p.strategy)}`);
  }

  const allowed = p.allowed === true;
  if (!workingDirectory || !command) {
    throw new DeploymentExecutionError("Deployment profile requires workingDirectory and command.");
  }
  if (args.some((a) => /[;|&`$]/.test(a)) || /[;|&`$]/.test(command)) {
    throw new DeploymentExecutionError("Deployment profile command/args contain forbidden shell characters.");
  }

  return normalizeDeploymentProfile({
    name,
    environmentName,
    strategy,
    workingDirectory,
    command,
    args,
    allowed,
    timeoutMs:
      typeof p.timeoutMs === "number" && p.timeoutMs > 0
        ? Math.min(p.timeoutMs, 600_000)
        : DEFAULT_TIMEOUT_MS,
  });
}

function normalizeDeploymentProfile(profile: DeploymentProfileConfig): DeploymentProfileConfig {
  return {
    ...profile,
    allowed: profile.allowed === true && profile.strategy === "fixed_command",
  };
}

function loadProfilesFromEnv(): DeploymentProfileConfig[] {
  const json = process.env.ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON?.trim();
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DeploymentExecutionError(
      "ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON is not valid JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DeploymentExecutionError(
      "ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON must be a JSON array.",
    );
  }
  return parsed.map(assertProfileShape);
}

let testProfilesOverride: DeploymentProfileConfig[] | null = null;

export function setDeploymentProfilesForTests(profiles: DeploymentProfileConfig[] | null): void {
  testProfilesOverride = profiles;
}

export function listDeploymentProfiles(): DeploymentProfileConfig[] {
  const profiles = testProfilesOverride ? [...testProfilesOverride] : loadProfilesFromEnv();
  return profiles.map(normalizeDeploymentProfile);
}

export function getDeploymentProfileByName(name: string): DeploymentProfileConfig | null {
  return listDeploymentProfiles().find((p) => p.name === name) ?? null;
}

/** Resolve a profile for execution; fails closed if missing, disabled, or non-executable strategy. */
export function resolveExecutableDeploymentProfile(profileName: string): DeploymentProfileConfig {
  const profile = getDeploymentProfileByName(profileName.trim());
  if (!profile) {
    throw new DeploymentExecutionError(`Deployment profile not found: ${profileName}`);
  }
  if (!profile.allowed) {
    throw new DeploymentExecutionError(`Deployment profile is disabled: ${profileName}`);
  }
  if (profile.strategy !== "fixed_command") {
    throw new DeploymentExecutionError(
      `Deployment profile strategy is not executable: ${profile.strategy}`,
    );
  }
  return profile;
}

export function listPublicDeploymentProfiles(): DeploymentProfilePublicMetadata[] {
  return listDeploymentProfiles().map((p) => ({
    name: p.name,
    environmentName: p.environmentName,
    strategy: p.strategy,
    enabled: p.allowed,
  }));
}

export function listPublicDeploymentProfilesForEnvironment(
  environmentName: string,
): DeploymentProfilePublicMetadata[] {
  return listPublicDeploymentProfiles().filter((p) => p.environmentName === environmentName);
}

export function buildCommandLabel(profile: DeploymentProfileConfig): string {
  return [profile.command, ...profile.args].join(" ");
}
