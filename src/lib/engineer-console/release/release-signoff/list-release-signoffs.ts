import { getEngineerConsoleDb } from "../../db/client";
import type { ReleaseSignoffRecord, ReleaseSignoffRow } from "./release-signoff-types";

function mapRow(row: ReleaseSignoffRow): ReleaseSignoffRecord {
  return {
    id: row.id,
    runId: row.run_id,
    releaseChecklistId: row.release_checklist_id,
    releaseChecklistStatus: row.release_checklist_status,
    decision: row.decision as ReleaseSignoffRecord["decision"],
    actorType: row.actor_type as ReleaseSignoffRecord["actorType"],
    actorLabel: row.actor_label,
    rationale: row.rationale,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    auditEventId: row.audit_event_id,
    auditChainHash: row.audit_chain_hash,
    signoffSnapshotJson: row.signoff_snapshot_json,
    createdAt: row.created_at,
  };
}

export function listReleaseSignoffsForRun(runId: string): ReleaseSignoffRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_release_signoffs WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as ReleaseSignoffRow[];
  return rows.map(mapRow);
}

export function getLatestReleaseSignoffForRun(runId: string): ReleaseSignoffRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_release_signoffs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as ReleaseSignoffRow | undefined;
  return row ? mapRow(row) : null;
}
