const MANAGED_KEYS = [
  "ENGINEER_CONSOLE_REPO_ROOTS",
  "ENGINEER_CONSOLE_RELEASE_GATES_ENABLED",
] as const;

export type ManagedTestEnvKey = (typeof MANAGED_KEYS)[number];

export type EngineerConsoleTestEnvSnapshot = Partial<Record<ManagedTestEnvKey, string | undefined>>;

export function snapshotEngineerConsoleTestEnv(): EngineerConsoleTestEnvSnapshot {
  const snapshot: EngineerConsoleTestEnvSnapshot = {};
  for (const key of MANAGED_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

export function restoreEngineerConsoleTestEnv(snapshot: EngineerConsoleTestEnvSnapshot): void {
  for (const key of MANAGED_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/** Baseline unit-test env: no staging allowlist; hard gates off unless a test opts in. */
export function resetEngineerConsoleTestEnvDefaults(): void {
  delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
  delete process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED;
}

export function setTestRepoRootsAllowlist(...roots: string[]): void {
  if (roots.length === 0) {
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    return;
  }
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = roots.join(",");
}

export function enableHardReleaseGatesForTest(): void {
  process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED = "true";
}

export function disableHardReleaseGatesForTest(): void {
  delete process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED;
}
