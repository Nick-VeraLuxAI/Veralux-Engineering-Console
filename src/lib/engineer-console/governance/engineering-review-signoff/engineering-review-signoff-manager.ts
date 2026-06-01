import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import type {
  EngineeringReviewSignoffDecision,
  EngineeringReviewSignoffRecord,
} from "./engineering-review-signoff-types";

function nowIso(): string {
  return new Date().toISOString();
}

interface Row {
  id: string;
  run_id: string;
  decision: string;
  reviewer: string;
  reason: string;
  evidence_snapshot_hash: string;
  evidence_summary_json: string;
  quality_gate_summary_json: string;
  patch_application_summary_json: string;
  created_at: string;
}

function mapRow(row: Row): EngineeringReviewSignoffRecord {
  return {
    id: row.id,
    runId: row.run_id,
    decision: row.decision as EngineeringReviewSignoffDecision,
    reviewer: row.reviewer,
    reason: row.reason,
    evidenceSnapshotHash: row.evidence_snapshot_hash,
    evidenceSummaryJson: row.evidence_summary_json,
    qualityGateSummaryJson: row.quality_gate_summary_json,
    patchApplicationSummaryJson: row.patch_application_summary_json,
    createdAt: row.created_at,
  };
}

export function insertEngineeringReviewSignoff(input: {
  runId: string;
  decision: EngineeringReviewSignoffDecision;
  reviewer: string;
  reason: string;
  evidenceSnapshotHash: string;
  evidenceSummaryJson: string;
  qualityGateSummaryJson: string;
  patchApplicationSummaryJson: string;
}): EngineeringReviewSignoffRecord {
  const id = uuidv4();
  const createdAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_run_review_signoffs
        (id, run_id, decision, reviewer, reason, evidence_snapshot_hash,
         evidence_summary_json, quality_gate_summary_json, patch_application_summary_json, created_at)
       VALUES
        (@id, @run_id, @decision, @reviewer, @reason, @evidence_snapshot_hash,
         @evidence_summary_json, @quality_gate_summary_json, @patch_application_summary_json, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      decision: input.decision,
      reviewer: input.reviewer,
      reason: input.reason,
      evidence_snapshot_hash: input.evidenceSnapshotHash,
      evidence_summary_json: input.evidenceSummaryJson,
      quality_gate_summary_json: input.qualityGateSummaryJson,
      patch_application_summary_json: input.patchApplicationSummaryJson,
      created_at: createdAt,
    });
  return {
    id,
    runId: input.runId,
    decision: input.decision,
    reviewer: input.reviewer,
    reason: input.reason,
    evidenceSnapshotHash: input.evidenceSnapshotHash,
    evidenceSummaryJson: input.evidenceSummaryJson,
    qualityGateSummaryJson: input.qualityGateSummaryJson,
    patchApplicationSummaryJson: input.patchApplicationSummaryJson,
    createdAt,
  };
}

export function listEngineeringReviewSignoffsForRun(
  runId: string,
): EngineeringReviewSignoffRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_run_review_signoffs WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as Row[];
  return rows.map(mapRow);
}

export function getLatestEngineeringReviewSignoffForRun(
  runId: string,
): EngineeringReviewSignoffRecord | null {
  return listEngineeringReviewSignoffsForRun(runId)[0] ?? null;
}
