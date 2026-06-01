import { createHash } from "crypto";
import { normalizeHermesPath } from "./hermes-policy";

export class UnifiedDiffParseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UnifiedDiffParseError";
    this.code = code;
  }
}

/** Validate unified diff shape and return normalized changed paths (b/ side). */
export function parseUnifiedDiffPaths(diffText: string): string[] {
  const trimmed = diffText.trim();
  if (!trimmed) {
    throw new UnifiedDiffParseError("Patch diff is empty", "EMPTY_PATCH");
  }

  const hasDiffHeader = /^---\s/m.test(trimmed) && /^\+\+\+\s/m.test(trimmed);
  if (!hasDiffHeader) {
    throw new UnifiedDiffParseError(
      "Patch must be a unified diff with ---/+++ headers",
      "INVALID_UNIFIED_DIFF",
    );
  }

  const paths = new Set<string>();
  for (const line of trimmed.split("\n")) {
    const match = line.match(/^(?:---|\+\+\+)\s+(?:a\/|b\/)?(.+)$/);
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    if (raw === "/dev/null" || raw === "dev/null") continue;
    paths.add(normalizeHermesPath(raw));
  }

  if (paths.size === 0) {
    throw new UnifiedDiffParseError("No file paths found in unified diff", "NO_PATCH_PATHS");
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function hashPatchDiffContent(diffText: string): string {
  return createHash("sha256").update(diffText, "utf8").digest("hex");
}
