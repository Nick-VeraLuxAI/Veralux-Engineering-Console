import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import {
  auditReleaseChecklistEvaluated,
  auditReleaseChecklistFailed,
} from "./release-checklist-audit-lifecycle";
import { buildReleaseChecklist } from "./build-release-checklist";
import { toStorableReleaseChecklistEvaluation } from "./sanitize-release-checklist-evaluation";
import type {
  ReleaseChecklistEvaluation,
  ReleaseChecklistRecord,
  ReleaseChecklistStatus,
} from "./release-checklist-types";
import { ReleaseChecklistError } from "./release-checklist-types";

interface ChecklistRow {
  id: string;
  run_id: string;
  status: string;
  checklist_json: string;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: ChecklistRow): ReleaseChecklistRecord {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status as ReleaseChecklistStatus,
    checklistJson: row.checklist_json,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function persistChecklist(evaluation: ReleaseChecklistEvaluation): ReleaseChecklistRecord {
  const id = uuidv4();
  const now = nowIso();
  const checklistJson = JSON.stringify(toStorableReleaseChecklistEvaluation(evaluation));

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_release_checklists
        (id, run_id, status, checklist_json, evidence_bundle_id, evidence_bundle_hash,
         created_at, updated_at)
       VALUES
        (@id, @run_id, @status, @checklist_json, @evidence_bundle_id, @evidence_bundle_hash,
         @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: evaluation.runId,
      status: evaluation.status,
      checklist_json: checklistJson,
      evidence_bundle_id: evaluation.evidenceBundleId,
      evidence_bundle_hash: evaluation.evidenceBundleHash,
      created_at: now,
      updated_at: now,
    });

  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_release_checklists WHERE id = ?`)
    .get(id) as ChecklistRow;
  return mapRow(row);
}

export function listReleaseChecklistsForRun(runId: string): ReleaseChecklistRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_release_checklists WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as ChecklistRow[];
  return rows.map(mapRow);
}

export function getLatestReleaseChecklistForRun(runId: string): ReleaseChecklistRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_release_checklists WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as ChecklistRow | undefined;
  return row ? mapRow(row) : null;
}

export function parseReleaseChecklistEvaluation(
  record: ReleaseChecklistRecord,
): ReleaseChecklistEvaluation {
  const parsed = JSON.parse(record.checklistJson) as ReleaseChecklistEvaluation;
  return {
    ...parsed,
    evidenceBundleId: record.evidenceBundleId,
    evidenceBundleHash: record.evidenceBundleHash,
  };
}

export function toPublicReleaseChecklist(
  evaluation: ReleaseChecklistEvaluation,
  meta?: { id?: string; createdAt?: string; updatedAt?: string },
) {
  return {
    id: meta?.id ?? null,
    runId: evaluation.runId,
    status: evaluation.status,
    evaluatedAt: evaluation.evaluatedAt,
    items: evaluation.items,
    blockers: evaluation.blockers,
    needsAttention: evaluation.needsAttention,
    recommendedAction: evaluation.recommendedAction,
    evidenceBundleHashPrefix: evaluation.evidenceBundleHash?.slice(0, 12) ?? null,
    createdAt: meta?.createdAt ?? null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export function summarizeReleaseChecklistForRun(runId: string): {
  evaluationCount: number;
  latestStatus: string | null;
  latestRecommendedAction: string | null;
  blockerCount: number;
  needsAttentionCount: number;
} {
  const latest = getLatestReleaseChecklistForRun(runId);
  if (latest) {
    const evaluation = parseReleaseChecklistEvaluation(latest);
    return {
      evaluationCount: listReleaseChecklistsForRun(runId).length,
      latestStatus: latest.status,
      latestRecommendedAction: evaluation.recommendedAction,
      blockerCount: evaluation.blockers.length,
      needsAttentionCount: evaluation.needsAttention.length,
    };
  }

  const computed = buildReleaseChecklist(runId);
  return {
    evaluationCount: 0,
    latestStatus: computed.status,
    latestRecommendedAction: computed.recommendedAction,
    blockerCount: computed.blockers.length,
    needsAttentionCount: computed.needsAttention.length,
  };
}

export async function runReleaseChecklistEvaluation(
  runId: string,
  options: {
    persist?: boolean;
    audit?: boolean;
    actorType?: string;
    actorLabel?: string;
    refreshEvidence?: boolean;
  } = {},
): Promise<ReleaseChecklistEvaluation> {
  const persist = options.persist ?? true;
  const audit = options.audit ?? persist;
  const actorLabel = options.actorLabel ?? "system";

  if (options.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new ReleaseChecklistError("Models cannot evaluate release checklist.");
  }

  const run = getRunById(runId);
  if (!run) {
    throw new ReleaseChecklistError(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);

  try {
    const evaluation = buildReleaseChecklist(runId);

    if (persist) {
      const record = persistChecklist(evaluation);
      if (audit) {
        auditReleaseChecklistEvaluated(runId, task?.id ?? null, {
          checklistId: record.id,
          checklistStatus: evaluation.status,
          blockerCount: evaluation.blockers.length,
          needsAttentionCount: evaluation.needsAttention.length,
          actorLabel,
        });
      }
    }

    if (options.refreshEvidence === true && persist) {
      const { refreshRunEvidenceBundle } = await import(
        "../../governance/evidence-bundles/evidence-bundle-manager"
      );
      await refreshRunEvidenceBundle({ runId });
    }

    return evaluation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (audit) {
      auditReleaseChecklistFailed(runId, task?.id ?? null, { message, actorLabel });
    }
    throw error instanceof ReleaseChecklistError
      ? error
      : new ReleaseChecklistError(message);
  }
}
