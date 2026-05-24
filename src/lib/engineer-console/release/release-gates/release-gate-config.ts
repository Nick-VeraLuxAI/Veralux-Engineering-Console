export interface ReleaseGateConfig {
  hardGatesEnabled: boolean;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function getReleaseGateConfig(env: NodeJS.ProcessEnv = process.env): ReleaseGateConfig {
  return {
    hardGatesEnabled: parseBool(env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED),
  };
}

export function isHardReleaseGatesEnabled(config: ReleaseGateConfig = getReleaseGateConfig()): boolean {
  return config.hardGatesEnabled;
}

export function getPublicReleaseGateConfig(
  config: ReleaseGateConfig = getReleaseGateConfig(),
): { hardGatesEnabled: boolean } {
  return { hardGatesEnabled: config.hardGatesEnabled };
}
