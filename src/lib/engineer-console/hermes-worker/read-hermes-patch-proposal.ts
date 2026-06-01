import fs from "fs";
import path from "path";
import type { HermesWorkerDispatchRecord } from "./hermes-run-packet-types";
import type { HermesEngineeringEvidenceV1 } from "./hermes-evidence-types";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";

const PATCH_PREVIEW_MAX_CHARS = 8_000;
const SUMMARY_EXCERPT_MAX_CHARS = 2_000;

export const HERMES_PATCH_ARTIFACT_FILES = {
  proposedPatch: "proposed-patch.diff",
  proposedSummary: "proposed-changes-summary.md",
  proposedFiles: "proposed-files.json",
} as const;

export interface HermesProposedFileEntry {
  path: string;
  changeType: "add" | "modify" | "delete";
  reason: string;
  allowedByPolicy: boolean;
}

export interface HermesPatchProposalView {
  available: boolean;
  status: "patch_proposed" | "failed" | null;
  mode: string | null;
  changesApplied: false;
  changedFileCount: number;
  proposedPatchPath: string | null;
  summaryPath: string | null;
  proposedFilesPath: string | null;
  proposedPatchPreview: string | null;
  summaryExcerpt: string | null;
  proposedFiles: HermesProposedFileEntry[];
  /** Read-only — evidence only, not approval. */
  evidenceOnlyNotSignOff: true;
}

export const EMPTY_HERMES_PATCH_PROPOSAL_VIEW: HermesPatchProposalView = {
  available: false,
  status: null,
  mode: null,
  changesApplied: false,
  changedFileCount: 0,
  proposedPatchPath: null,
  summaryPath: null,
  proposedFilesPath: null,
  proposedPatchPreview: null,
  summaryExcerpt: null,
  proposedFiles: [],
  evidenceOnlyNotSignOff: true,
};

function evidenceDirectoryForDispatch(dispatch: HermesWorkerDispatchRecord): string {
  return path.dirname(dispatch.evidencePlaceholderPath);
}

function resolveArtifactPath(dispatch: HermesWorkerDispatchRecord, fileName: string): string {
  return path.join(evidenceDirectoryForDispatch(dispatch), fileName);
}

function readTextIfExists(filePath: string, maxChars?: number): string | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (maxChars && text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n…(truncated)`;
  }
  return text;
}

export function readHermesPatchProposalArtifacts(
  dispatch: HermesWorkerDispatchRecord,
  evidence: HermesEngineeringEvidenceV1 | null,
): HermesPatchProposalView {
  if (!evidence || evidence.mode !== "patch-proposal") {
    return { ...EMPTY_HERMES_PATCH_PROPOSAL_VIEW, mode: evidence?.mode ?? null };
  }

  const patchPath =
    evidence.artifacts?.proposedPatchPath ??
    resolveArtifactPath(dispatch, HERMES_PATCH_ARTIFACT_FILES.proposedPatch);
  const summaryPath =
    evidence.artifacts?.summaryPath ??
    resolveArtifactPath(dispatch, HERMES_PATCH_ARTIFACT_FILES.proposedSummary);
  const filesPath =
    evidence.artifacts?.proposedFilesPath ??
    resolveArtifactPath(dispatch, HERMES_PATCH_ARTIFACT_FILES.proposedFiles);

  let proposedFiles: HermesProposedFileEntry[] = [];
  if (fs.existsSync(filesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filesPath, "utf8")) as {
        files?: HermesProposedFileEntry[];
      };
      proposedFiles = parsed.files ?? [];
    } catch {
      proposedFiles = [];
    }
  }

  const isPatchProposed = evidence.status === "patch_proposed";

  return {
    available: isPatchProposed && fs.existsSync(patchPath),
    status: evidence.status === "patch_proposed" ? "patch_proposed" : evidence.status === "failed" ? "failed" : null,
    mode: "patch-proposal",
    changesApplied: false,
    changedFileCount: evidence.filesProposedForChange?.length ?? proposedFiles.length,
    proposedPatchPath: fs.existsSync(patchPath) ? patchPath : null,
    summaryPath: fs.existsSync(summaryPath) ? summaryPath : null,
    proposedFilesPath: fs.existsSync(filesPath) ? filesPath : null,
    proposedPatchPreview: readTextIfExists(patchPath, PATCH_PREVIEW_MAX_CHARS),
    summaryExcerpt: readTextIfExists(summaryPath, SUMMARY_EXCERPT_MAX_CHARS),
    proposedFiles,
    evidenceOnlyNotSignOff: true,
  };
}

export function isHermesPatchProposalEvidence(
  evidence: HermesEngineeringEvidenceV1 | null,
): boolean {
  return evidence?.mode === "patch-proposal" && evidence.status === "patch_proposed";
}

export function resolveHermesEvidenceDirectory(dispatch: HermesWorkerDispatchRecord): string {
  return path.dirname(resolveHermesEvidenceReportPath(dispatch));
}
