import { normalizeRelativePath } from "../worker-plan/path-safety";

/** Global paths Hermes must never touch (in addition to worker-plan scope). */
export const HERMES_GLOBAL_FORBIDDEN_PATHS: readonly string[] = [
  ".env",
  ".git",
  "node_modules",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".github/workflows",
  "secrets",
  "dist",
  "build",
  "coverage",
] as const;

/** Commands Hermes may run when Console lists them as expected quality gates. */
export const HERMES_ALLOWED_QUALITY_GATE_COMMANDS: readonly string[] = [
  "npm test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
] as const;

export const HERMES_PACKET_LIMITS = {
  maxPacketBytes: 256 * 1024,
  maxAllowedPaths: 200,
  maxInstructionsChars: 32_000,
  maxTitleChars: 500,
} as const;

export function normalizeHermesPath(input: string): string {
  return normalizeRelativePath(input.trim());
}

export function dedupeSortedPaths(paths: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of paths) {
    const normalized = normalizeHermesPath(raw);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function filterHermesAllowedCommands(commands: string[]): string[] {
  const allowed = new Set(HERMES_ALLOWED_QUALITY_GATE_COMMANDS);
  const out: string[] = [];
  for (const command of commands) {
    const trimmed = command.trim();
    if (allowed.has(trimmed)) out.push(trimmed);
  }
  return [...new Set(out)];
}

export function assertPathsWithinPolicy(
  paths: string[],
  allowedPaths: string[],
): void {
  const allowed = new Set(allowedPaths.map(normalizeHermesPath));
  for (const p of paths) {
    const normalized = normalizeHermesPath(p);
    if (!allowed.has(normalized)) {
      throw new HermesPolicyError(
        `Path "${normalized}" is not in the worker plan allowed scope`,
        "PATH_OUT_OF_SCOPE",
      );
    }
  }
}

export class HermesPolicyError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "HermesPolicyError";
    this.code = code;
  }
}
