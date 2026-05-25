import { getEngineerConsoleDb } from "../../db/client";
import type { AuditEventRecord, AuditEventRow, AuditChainVerificationResult } from "./audit-ledger-types";
import { resolveAuditChainScope } from "./audit-ledger-types";
import { verifyAuditChain } from "./verify-audit-chain";

function mapRow(row: AuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    chainScope: row.chain_scope,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    taskId: row.task_id,
    runId: row.run_id,
    payloadHash: row.payload_hash,
    payloadJson: row.payload_json,
    previousEventHash: row.previous_event_hash,
    chainHash: row.chain_hash,
    createdAt: row.created_at,
  };
}

export function listAuditEventsForRun(runId: string): AuditEventRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_audit_events
       WHERE run_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(runId) as AuditEventRow[];
  return rows.map(mapRow);
}

export function listAuditEventsForChainScope(
  chainScope: string = resolveAuditChainScope(),
): AuditEventRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_audit_events
       WHERE chain_scope = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(chainScope) as AuditEventRow[];
  return rows.map(mapRow);
}

export function verifyAuditChainForScope(
  chainScope: string = resolveAuditChainScope(),
): AuditChainVerificationResult {
  const events = listAuditEventsForChainScope(chainScope);
  return verifyAuditChain(events);
}

export function verifyAuditChainForRun(runId: string): AuditChainVerificationResult {
  const runEvents = listAuditEventsForRun(runId);
  const runResult = verifyAuditChain(runEvents);

  const scopeResult = verifyAuditChainForScope();
  const scopeFailures = scopeResult.failures.filter((f) =>
    f.startsWith("duplicate_previous_hash:") || f.startsWith("duplicate_chain_hash:"),
  );

  const failures = [...new Set([...runResult.failures, ...scopeFailures])];
  return {
    ok: runResult.ok && scopeFailures.length === 0,
    checkedCount: runResult.checkedCount,
    failures,
  };
}

/** Public API response shape (no raw secrets in payload). */
export function toPublicAuditEvent(event: AuditEventRecord) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  return {
    id: event.id,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId,
    actorType: event.actorType,
    actorLabel: event.actorLabel,
    taskId: event.taskId,
    runId: event.runId,
    payload,
    payloadHash: event.payloadHash,
    previousEventHash: event.previousEventHash,
    chainHashPrefix: event.chainHash.slice(0, 12),
    chainHash: event.chainHash,
    createdAt: event.createdAt,
  };
}

export { appendAuditEvent, requireAuditEvent } from "./append-audit-event";
export { verifyAuditChain } from "./verify-audit-chain";
export { AUDIT_EVENT_TYPES, AUDIT_ENTITY_TYPES, AUDIT_ACTOR_TYPES } from "./audit-event-types";
