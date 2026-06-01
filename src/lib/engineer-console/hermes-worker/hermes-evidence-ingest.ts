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
import {
  EMPTY_HERMES_PATCH_PROPOSAL_VIEW,
  readHermesPatchProposalArtifacts,
} from "./read-hermes-patch-proposal";

export interface HermesWorkerEvidenceIngestResult {
  summary: HermesWorkerEvidenceSummary;
  evidence: HermesEngineeringEvidenceV1 | null;
  patchProposal: ReturnType<typeof readHermesPatchProposalArtifacts>;
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
      summary: toHermesWorkerEvidenceSummary(null, null, runId),
      evidence: null,
      patchProposal: EMPTY_HERMES_PATCH_PROPOSAL_VIEW,
      dispatchId: null,
      auditRecorded: false,
    };
  }

  const dispatches = listHermesDispatchesForRun(runId);
  const latest = getLatestHermesWorkerEvidenceForRun(dispatches);

  if (!latest) {
    const latestDispatch = dispatches[0] ?? null;
    return {
      summary: toHermesWorkerEvidenceSummary(latestDispatch, null, runId),
      evidence: null,
      patchProposal: EMPTY_HERMES_PATCH_PROPOSAL_VIEW,
      dispatchId: latestDispatch?.id ?? null,
      auditRecorded: false,
    };
  }

  const patchProposal = readHermesPatchProposalArtifacts(latest.dispatch, latest.evidence);

  let auditRecorded = false;
  if (!hasEvidenceReceivedAudit(runId, latest.dispatch.id)) {
    auditHermesEvidenceReceived(runId, run.taskId, latest.dispatch.id, {
      evidenceStatus: latest.evidence.status,
      reportPath: resolveHermesEvidenceReportPath(latest.dispatch),
      boundaryValid: latest.evidence.boundaryValidation?.valid ?? null,
      evidenceOnly: true,
      notSignOff: true,
      patchProposal: patchProposal.available,
      changesApplied: latest.evidence.changesApplied === true,
    });
    auditRecorded = true;
  }

  return {
    summary: toHermesWorkerEvidenceSummary(latest.dispatch, latest.evidence, runId),
    evidence: latest.evidence,
    patchProposal,
    dispatchId: latest.dispatch.id,
    auditRecorded,
  };
}
