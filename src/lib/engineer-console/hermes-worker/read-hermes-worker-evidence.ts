import fs from "fs";
import path from "path";
import {
  HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
  type HermesEngineeringEvidenceV1,
  type HermesWorkerEvidenceSummary,
} from "./hermes-evidence-types";
import type { HermesWorkerDispatchRecord } from "./hermes-run-packet-types";
import { readHermesPatchProposalArtifacts } from "./read-hermes-patch-proposal";

export function resolveHermesEvidenceReportPath(dispatch: HermesWorkerDispatchRecord): string {
  return path.join(
    path.dirname(dispatch.evidencePlaceholderPath),
    "worker-report.json",
  );
}

export function parseHermesEngineeringEvidenceJson(json: string): HermesEngineeringEvidenceV1 {
  const parsed = JSON.parse(json) as HermesEngineeringEvidenceV1;
  if (parsed.schemaVersion !== HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Hermes evidence schema: ${String(parsed.schemaVersion)}`);
  }
  return parsed;
}

export function readHermesEvidenceReportForDispatch(
  dispatch: HermesWorkerDispatchRecord,
): HermesEngineeringEvidenceV1 | null {
  const reportPath = resolveHermesEvidenceReportPath(dispatch);
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    return parseHermesEngineeringEvidenceJson(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

export function toHermesWorkerEvidenceSummary(
  dispatch: HermesWorkerDispatchRecord | null,
  evidence: HermesEngineeringEvidenceV1 | null,
): HermesWorkerEvidenceSummary {
  const emptyPatch = {
    available: false,
    status: null,
    changedFileCount: 0,
    proposedPatchPath: null,
    summaryPath: null,
    proposedFilesPath: null,
    proposedPatchPreview: null,
    summaryExcerpt: null,
  };

  if (!dispatch || !evidence) {
    return {
      available: false,
      dispatchId: dispatch?.id ?? null,
      status: null,
      mode: null,
      inspectedAt: null,
      reportPath: dispatch ? resolveHermesEvidenceReportPath(dispatch) : null,
      instructionsSummary: null,
      filesInspectedCount: 0,
      boundaryValid: null,
      evidenceOnlyNotSignOff: true,
      proposedChangesMode: null,
      changesApplied: false,
      patchProposal: emptyPatch,
    };
  }

  const patchView = readHermesPatchProposalArtifacts(dispatch, evidence);

  return {
    available: true,
    dispatchId: dispatch.id,
    status: evidence.status,
    mode: evidence.mode ?? null,
    inspectedAt: evidence.timestamp,
    reportPath: resolveHermesEvidenceReportPath(dispatch),
    instructionsSummary: evidence.instructionsSummary ?? null,
    filesInspectedCount: evidence.filesInspected?.length ?? 0,
    boundaryValid: evidence.boundaryValidation?.valid ?? null,
    evidenceOnlyNotSignOff: true,
    proposedChangesMode: evidence.proposedChanges?.mode ?? evidence.mode ?? null,
    changesApplied: evidence.changesApplied === true,
    patchProposal: {
      available: patchView.available,
      status: patchView.status,
      changedFileCount: patchView.changedFileCount,
      proposedPatchPath: patchView.proposedPatchPath,
      summaryPath: patchView.summaryPath,
      proposedFilesPath: patchView.proposedFilesPath,
      proposedPatchPreview: patchView.proposedPatchPreview,
      summaryExcerpt: patchView.summaryExcerpt,
    },
  };
}

export function getLatestHermesWorkerEvidenceForRun(
  dispatches: HermesWorkerDispatchRecord[],
): { dispatch: HermesWorkerDispatchRecord; evidence: HermesEngineeringEvidenceV1 } | null {
  for (const dispatch of dispatches) {
    const evidence = readHermesEvidenceReportForDispatch(dispatch);
    if (evidence) {
      return { dispatch, evidence };
    }
  }
  return null;
}
