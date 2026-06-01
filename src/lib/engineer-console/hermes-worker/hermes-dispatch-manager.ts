import fs from "fs";
import path from "path";
import { getEngineerConsoleDb } from "../db/client";
import {
  auditHermesEvidencePlaceholderCreated,
  auditHermesRunDispatched,
  auditHermesRunPacketPrepared,
} from "../governance/audit-ledger/hermes-audit-lifecycle";
import { getRunById } from "../run-manager/run-manager";
import { buildHermesRunPacketForRun, HermesRunPacketError } from "./build-hermes-run-packet";
import { ensureParentDir, getHermesInboxRoot } from "./hermes-paths";
import {
  HERMES_WORKER_BACKEND,
  type HermesDispatchStatus,
  type HermesRunPacketV1,
  type HermesWorkerDispatchRecord,
} from "./hermes-run-packet-types";

function nowIso(): string {
  return new Date().toISOString();
}

interface HermesDispatchRow {
  id: string;
  run_id: string;
  task_id: string;
  worker_plan_id: string | null;
  worker_backend: string;
  status: string;
  packet_hash: string;
  packet_json: string;
  export_path: string | null;
  evidence_placeholder_path: string;
  prepared_at: string;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: HermesDispatchRow): HermesWorkerDispatchRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    workerPlanId: row.worker_plan_id,
    workerBackend: HERMES_WORKER_BACKEND,
    status: row.status as HermesDispatchStatus,
    packetHash: row.packet_hash,
    packetJson: row.packet_json,
    exportPath: row.export_path,
    evidencePlaceholderPath: row.evidence_placeholder_path,
    preparedAt: row.prepared_at,
    dispatchedAt: row.dispatched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseHermesRunPacketJson(json: string): HermesRunPacketV1 {
  return JSON.parse(json) as HermesRunPacketV1;
}

export function getHermesDispatchById(id: string): HermesWorkerDispatchRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_hermes_worker_dispatches WHERE id = ?`)
    .get(id) as HermesDispatchRow | undefined;
  return row ? mapRow(row) : null;
}

export function getLatestHermesDispatchForRun(runId: string): HermesWorkerDispatchRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_hermes_worker_dispatches WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as HermesDispatchRow | undefined;
  return row ? mapRow(row) : null;
}

export function listHermesDispatchesForRun(runId: string): HermesWorkerDispatchRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_hermes_worker_dispatches WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as HermesDispatchRow[];
  return rows.map(mapRow);
}

function writeEvidencePlaceholder(placeholderPath: string, dispatchId: string, runId: string): void {
  ensureParentDir(placeholderPath);
  const body = {
    status: "pending",
    source: "engineering-console",
    dispatchId,
    runId,
    note: "Awaiting Hermes worker output. Treat as evidence input only; Console governs sign-off.",
    createdAt: nowIso(),
  };
  fs.writeFileSync(placeholderPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export interface PrepareHermesRunResult {
  dispatch: HermesWorkerDispatchRecord;
  packet: HermesRunPacketV1;
}

/** Persist packet snapshot, evidence placeholder, and audit events (no Hermes execution). */
export function prepareHermesRunForEngineeringRun(runId: string): PrepareHermesRunResult {
  const run = getRunById(runId);
  if (!run) {
    throw new HermesRunPacketError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const built = buildHermesRunPacketForRun(runId);
  const { packet, packetHash, workerPlanId, evidencePlaceholderPath } = built;
  const dispatchId = packet.dispatchId;
  const now = nowIso();

  writeEvidencePlaceholder(evidencePlaceholderPath, dispatchId, runId);

  const db = getEngineerConsoleDb();
  db.prepare(
    `INSERT INTO engineer_hermes_worker_dispatches
      (id, run_id, task_id, worker_plan_id, worker_backend, status, packet_hash, packet_json,
       export_path, evidence_placeholder_path, prepared_at, dispatched_at, created_at, updated_at)
     VALUES
      (@id, @run_id, @task_id, @worker_plan_id, @worker_backend, @status, @packet_hash, @packet_json,
       @export_path, @evidence_placeholder_path, @prepared_at, @dispatched_at, @created_at, @updated_at)`,
  ).run({
    id: dispatchId,
    run_id: runId,
    task_id: run.taskId,
    worker_plan_id: workerPlanId,
    worker_backend: HERMES_WORKER_BACKEND,
    status: "prepared",
    packet_hash: packetHash,
    packet_json: JSON.stringify(packet),
    export_path: null,
    evidence_placeholder_path: evidencePlaceholderPath,
    prepared_at: packet.engineeringConsole.preparedAt,
    dispatched_at: null,
    created_at: now,
    updated_at: now,
  });

  auditHermesRunPacketPrepared(runId, run.taskId, dispatchId, {
    workerBackend: HERMES_WORKER_BACKEND,
    packetHash,
    workerPlanId,
    allowedPathCount: packet.policy.allowedPaths.length,
    allowedCommandCount: packet.policy.allowedCommands.length,
  });
  auditHermesEvidencePlaceholderCreated(runId, run.taskId, dispatchId, {
    evidencePlaceholderPath,
  });

  const dispatch = getHermesDispatchById(dispatchId);
  if (!dispatch) {
    throw new Error("Hermes dispatch record missing after insert");
  }

  return { dispatch, packet };
}

export interface ExportHermesRunResult {
  dispatch: HermesWorkerDispatchRecord;
  exportPath: string;
}

/**
 * Export a prepared packet to the Hermes inbox (file handoff only).
 * Does not invoke Hermes runtime or shell commands.
 */
export function exportHermesRunPacketToInbox(dispatchId: string): ExportHermesRunResult {
  const dispatch = getHermesDispatchById(dispatchId);
  if (!dispatch) {
    throw new HermesRunPacketError("Hermes dispatch not found", "DISPATCH_NOT_FOUND", 404);
  }
  if (dispatch.status === "dispatched" && dispatch.exportPath) {
    return { dispatch, exportPath: dispatch.exportPath };
  }

  const packet = parseHermesRunPacketJson(dispatch.packetJson);
  const inboxRoot = getHermesInboxRoot();
  fs.mkdirSync(inboxRoot, { recursive: true });
  const exportPath = path.join(inboxRoot, `${dispatch.runId}-${dispatchId}.json`);
  fs.writeFileSync(exportPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  const dispatchedAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_hermes_worker_dispatches SET
        status = 'dispatched',
        export_path = @export_path,
        dispatched_at = @dispatched_at,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: dispatchId,
      export_path: exportPath,
      dispatched_at: dispatchedAt,
      updated_at: dispatchedAt,
    });

  auditHermesRunDispatched(dispatch.runId, dispatch.taskId, dispatchId, {
    workerBackend: HERMES_WORKER_BACKEND,
    packetHash: dispatch.packetHash,
    exportPath,
    exportMode: "inbox-file",
  });

  const updated = getHermesDispatchById(dispatchId);
  if (!updated) {
    throw new Error("Hermes dispatch record missing after export");
  }

  return { dispatch: updated, exportPath };
}

/** Prepare and export in one governed step (still no Hermes execution). */
export function prepareAndExportHermesRunForEngineeringRun(runId: string): ExportHermesRunResult {
  const { dispatch } = prepareHermesRunForEngineeringRun(runId);
  return exportHermesRunPacketToInbox(dispatch.id);
}

export function toPublicHermesDispatch(record: HermesWorkerDispatchRecord) {
  return {
    id: record.id,
    runId: record.runId,
    taskId: record.taskId,
    workerPlanId: record.workerPlanId,
    workerBackend: record.workerBackend,
    status: record.status,
    packetHash: record.packetHash,
    exportPath: record.exportPath,
    evidencePlaceholderPath: record.evidencePlaceholderPath,
    preparedAt: record.preparedAt,
    dispatchedAt: record.dispatchedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
