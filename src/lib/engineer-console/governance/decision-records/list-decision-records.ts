import { getEngineerConsoleDb } from "../../db/client";
import type { DecisionRecord, DecisionRecordRow, DecisionValue } from "./decision-record-types";

function mapRow(row: DecisionRecordRow): DecisionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    decision: row.decision as DecisionValue,
    actorType: row.actor_type as DecisionRecord["actorType"],
    actorLabel: row.actor_label,
    rationale: row.rationale,
    approvalReportId: row.approval_report_id,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    riskLevel: row.risk_level,
    canApprove: row.can_approve === 1,
    qualityGateState: row.quality_gate_state,
    auditEventId: row.audit_event_id,
    auditChainHash: row.audit_chain_hash,
    decisionSnapshotJson: row.decision_snapshot_json,
    createdAt: row.created_at,
  };
}

export function listDecisionRecordsForRun(runId: string): DecisionRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_decision_records
       WHERE run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(runId) as DecisionRecordRow[];
  return rows.map(mapRow);
}
