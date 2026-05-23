import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import {
  auditEvidenceBundleCreated,
  auditEvidenceBundleUpdated,
} from "../audit-ledger/evidence-audit-lifecycle";
import { buildRunEvidenceBundle, type BuildRunEvidenceBundleInput } from "./build-run-evidence-bundle";
import {
  EVIDENCE_REDACTION_VERSION,
  type EvidenceBundleRecord,
  EvidenceBundleError,
  type RunEvidenceBundleV1,
} from "./evidence-bundle-types";
import { hashEvidenceBundle } from "./hash-evidence-bundle";
import { redactEvidenceBundle } from "./redact-evidence-bundle";

function nowIso(): string {
  return new Date().toISOString();
}

interface EvidenceBundleRow {
  id: string;
  run_id: string;
  task_id: string | null;
  registered_repo_id: string | null;
  bundle_hash: string;
  bundle_json: string;
  redaction_version: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: EvidenceBundleRow): EvidenceBundleRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    registeredRepoId: row.registered_repo_id,
    bundleHash: row.bundle_hash,
    bundleJson: row.bundle_json,
    redactionVersion: row.redaction_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEvidenceBundleForRun(runId: string): EvidenceBundleRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_run_evidence_bundles WHERE run_id = ?`)
    .get(runId) as EvidenceBundleRow | undefined;
  return row ? mapRow(row) : null;
}

export function parseEvidenceBundleJson(bundleJson: string): RunEvidenceBundleV1 {
  return JSON.parse(bundleJson) as RunEvidenceBundleV1;
}

export function toPublicEvidenceBundle(record: EvidenceBundleRecord) {
  return {
    id: record.id,
    runId: record.runId,
    bundleHash: record.bundleHash,
    redactionVersion: record.redactionVersion,
    bundle: parseEvidenceBundleJson(record.bundleJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Build, redact, hash, and persist evidence bundle. Fail-closed on errors. */
export async function refreshRunEvidenceBundle(
  input: BuildRunEvidenceBundleInput,
): Promise<EvidenceBundleRecord> {
  const built = await buildRunEvidenceBundle(input);
  const redacted = redactEvidenceBundle(built);
  const bundleHash = hashEvidenceBundle(redacted);
  const bundleJson = JSON.stringify(redacted);
  const now = nowIso();

  const existing = getEvidenceBundleForRun(input.runId);
  const db = getEngineerConsoleDb();

  if (existing) {
    db.prepare(
      `UPDATE engineer_run_evidence_bundles SET
        task_id = @task_id,
        registered_repo_id = @registered_repo_id,
        bundle_hash = @bundle_hash,
        bundle_json = @bundle_json,
        redaction_version = @redaction_version,
        updated_at = @updated_at
       WHERE run_id = @run_id`,
    ).run({
      run_id: input.runId,
      task_id: redacted.taskId,
      registered_repo_id: redacted.registeredRepoId,
      bundle_hash: bundleHash,
      bundle_json: bundleJson,
      redaction_version: EVIDENCE_REDACTION_VERSION,
      updated_at: now,
    });

    auditEvidenceBundleUpdated(input.runId, redacted.taskId, {
      bundleHash: bundleHash.slice(0, 12),
    });

    const row = db
      .prepare(`SELECT * FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .get(input.runId) as EvidenceBundleRow;
    return mapRow(row);
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO engineer_run_evidence_bundles
      (id, run_id, task_id, registered_repo_id, bundle_hash, bundle_json,
       redaction_version, created_at, updated_at)
     VALUES
      (@id, @run_id, @task_id, @registered_repo_id, @bundle_hash, @bundle_json,
       @redaction_version, @created_at, @updated_at)`,
  ).run({
    id,
    run_id: input.runId,
    task_id: redacted.taskId,
    registered_repo_id: redacted.registeredRepoId,
    bundle_hash: bundleHash,
    bundle_json: bundleJson,
    redaction_version: EVIDENCE_REDACTION_VERSION,
    created_at: now,
    updated_at: now,
  });

  auditEvidenceBundleCreated(input.runId, redacted.taskId, {
    bundleHash: bundleHash.slice(0, 12),
  });

  const row = db
    .prepare(`SELECT * FROM engineer_run_evidence_bundles WHERE id = ?`)
    .get(id) as EvidenceBundleRow;
  return mapRow(row);
}

export async function requireRunEvidenceBundle(runId: string): Promise<EvidenceBundleRecord> {
  const record = getEvidenceBundleForRun(runId);
  if (!record) {
    throw new EvidenceBundleError(
      `Evidence bundle missing for run ${runId}. Complete the run pipeline before approval.`,
    );
  }
  return record;
}
