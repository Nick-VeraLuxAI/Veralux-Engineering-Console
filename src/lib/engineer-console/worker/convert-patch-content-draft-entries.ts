import type { VeraApplicablePatchEntry } from "./vera-implementation-patch-proposal-types";
import type { VeraPatchContentDraftEntry } from "./vera-implementation-patch-content-draft-types";

export function convertPatchContentDraftEntriesToApplicable(
  entries: VeraPatchContentDraftEntry[],
): VeraApplicablePatchEntry[] {
  return entries.map((entry) => ({
    filePath: entry.filePath,
    action: entry.action === "create" ? "create_file" : "modify_file",
    rationale: "Approved patch content draft entry.",
    riskLevel: "low" as const,
    patchIncluded: true as const,
    patchContent: entry.patchContent,
    patchEncoding: "utf8" as const,
  }));
}
