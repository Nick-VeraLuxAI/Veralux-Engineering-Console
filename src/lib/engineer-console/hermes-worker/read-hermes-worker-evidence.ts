import fs from "fs";
import path from "path";
import {
  HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
  type HermesEngineeringEvidenceV1,
  type HermesWorkerEvidenceSummary,
} from "./hermes-evidence-types";
import type { HermesWorkerDispatchRecord } from "./hermes-run-packet-types";

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
  if (!dispatch || !evidence) {
    return {
      available: false,
      dispatchId: dispatch?.id ?? null,
      status: null,
      inspectedAt: null,
      reportPath: dispatch ? resolveHermesEvidenceReportPath(dispatch) : null,
      instructionsSummary: null,
      filesInspectedCount: 0,
      boundaryValid: null,
      evidenceOnlyNotSignOff: true,
      proposedChangesMode: null,
    };
  }

  return {
    available: true,
    dispatchId: dispatch.id,
    status: evidence.status,
    inspectedAt: evidence.timestamp,
    reportPath: resolveHermesEvidenceReportPath(dispatch),
    instructionsSummary: evidence.instructionsSummary ?? null,
    filesInspectedCount: evidence.filesInspected?.length ?? 0,
    boundaryValid: evidence.boundaryValidation?.valid ?? null,
    evidenceOnlyNotSignOff: true,
    proposedChangesMode: evidence.proposedChanges?.mode ?? null,
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
