import fs from "node:fs";
import path from "node:path";
import type { VeraApplicablePatchEntry } from "./vera-implementation-patch-proposal-types";
import type { VeraPatchApplicationFileAction } from "./vera-implementation-patch-application-types";
import { hashArtifactContent } from "./vera-implementation-artifact-storage";
import { validateApplicablePatchEntry } from "./vera-patch-path-safety";

export type VeraWorktreePatchApplyResult = {
  appliedFiles: Array<{
    filePath: string;
    action: VeraPatchApplicationFileAction;
    beforeHash?: string;
    afterHash?: string;
  }>;
};

function readFileHashIfExists(absolutePath: string): string | undefined {
  if (!fs.existsSync(absolutePath)) return undefined;
  return hashArtifactContent(fs.readFileSync(absolutePath, "utf8"));
}

export function applyVeraPatchEntriesToWorktree(
  worktreeRoot: string,
  entries: VeraApplicablePatchEntry[],
): VeraWorktreePatchApplyResult {
  const appliedFiles: VeraWorktreePatchApplyResult["appliedFiles"] = [];

  for (const entry of entries) {
    const validated = validateApplicablePatchEntry(entry, worktreeRoot);
    if (!validated.ok) {
      throw new Error(validated.reason);
    }

    const beforeHash = readFileHashIfExists(validated.absolutePath);
    const action: VeraPatchApplicationFileAction =
      entry.action === "create_file" ? "created" : "modified";

    fs.mkdirSync(path.dirname(validated.absolutePath), { recursive: true });
    fs.writeFileSync(validated.absolutePath, entry.patchContent, "utf8");

    appliedFiles.push({
      filePath: validated.relativePath,
      action,
      ...(beforeHash ? { beforeHash } : {}),
      afterHash: hashArtifactContent(entry.patchContent),
    });
  }

  return { appliedFiles };
}
