import { auditHermesEvidenceReceived } from "../governance/audit-ledger/hermes-audit-lifecycle";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { getRunById } from "../run-manager/run-manager";
import { listHermesDispatchesForRun } from "./hermes-dispatch-manager";
import {
  getLatestHermesWorkerEvidenceForRun,
  resolveHermesEvidenceReportPath,
  toHermesWorkerEvidenceSummary,
} from "./read-hermes-worker-evidence";
import type { HermesEngineeringEvidenceV1, HermesWorkerEvidenceSummary } from "./hermes-evidence-types";

export interface HermesWorkerEvidenceIngestResult {
  summary: HermesWorkerEvidenceSummary;
  evidence: HermesEngineeringEvidenceV1 | null;
  dispatchId: string | null;
  auditRecorded: boolean;
}

function hasEvidenceReceivedAudit(runId: string, dispatchId: string): boolean {
  return listAuditEventsForRun(runId).some(
    (event) =>
      event.eventType === AUDIT_EVENT_TYPES.HERMES_EVIDENCE_RECEIVED &&
      event.entityId === dispatchId,
  );
}

/** Read Hermes evidence from disk for a run; record audit once per dispatch when evidence exists. */
export function ingestHermesWorkerEvidenceForRun(runId: string): HermesWorkerEvidenceIngestResult {
  const run = getRunById(runId);
  if (!run) {
    return {
      summary: toHermesWorkerEvidenceSummary(null, null),
      evidence: null,
      dispatchId: null,
      auditRecorded: false,
    };
  }

  const dispatches = listHermesDispatchesForRun(runId);
  const latest = getLatestHermesWorkerEvidenceForRun(dispatches);

  if (!latest) {
    const latestDispatch = dispatches[0] ?? null;
    return {
      summary: toHermesWorkerEvidenceSummary(latestDispatch, null),
      evidence: null,
      dispatchId: latestDispatch?.id ?? null,
      auditRecorded: false,
    };
  }

  let auditRecorded = false;
  if (!hasEvidenceReceivedAudit(runId, latest.dispatch.id)) {
    auditHermesEvidenceReceived(runId, run.taskId, latest.dispatch.id, {
      evidenceStatus: latest.evidence.status,
      reportPath: resolveHermesEvidenceReportPath(latest.dispatch),
      boundaryValid: latest.evidence.boundaryValidation?.valid ?? null,
      evidenceOnly: true,
      notSignOff: true,
    });
    auditRecorded = true;
  }

  return {
    summary: toHermesWorkerEvidenceSummary(latest.dispatch, latest.evidence),
    evidence: latest.evidence,
    dispatchId: latest.dispatch.id,
    auditRecorded,
  };
}
