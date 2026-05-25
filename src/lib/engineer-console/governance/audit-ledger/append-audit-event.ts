import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { computeChainHash } from "./compute-chain-hash";
import { hashAuditPayload, redactAuditPayload } from "./hash-audit-payload";
import {
  AUDIT_CHAIN_GENESIS,
  type AppendAuditEventInput,
  type AuditEventRecord,
  type AuditEventRow,
  resolveAuditChainScope,
} from "./audit-ledger-types";

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

function appendWithinDb(db: Database.Database, input: AppendAuditEventInput): AuditEventRecord {
  const chainScope = input.chainScope ?? resolveAuditChainScope();
  const payload = redactAuditPayload(input.payload ?? {});
  const payloadHash = hashAuditPayload(payload);
  const payloadJson = JSON.stringify(payload);
  const createdAt = new Date().toISOString();
  const id = uuidv4();

  const last = db
    .prepare(
      `SELECT chain_hash FROM engineer_audit_events
       WHERE chain_scope = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(chainScope) as { chain_hash: string } | undefined;

  const previousChainHash = last?.chain_hash ?? AUDIT_CHAIN_GENESIS;
  const chainHash = computeChainHash({
    previousChainHash,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    payloadHash,
    createdAt,
  });

  const previousEventHash =
    previousChainHash === AUDIT_CHAIN_GENESIS ? null : previousChainHash;

  db.prepare(
    `INSERT INTO engineer_audit_events (
      id, chain_scope, event_type, entity_type, entity_id,
      actor_type, actor_label, task_id, run_id,
      payload_hash, payload_json, previous_event_hash, chain_hash, created_at
    ) VALUES (
      @id, @chain_scope, @event_type, @entity_type, @entity_id,
      @actor_type, @actor_label, @task_id, @run_id,
      @payload_hash, @payload_json, @previous_event_hash, @chain_hash, @created_at
    )`,
  ).run({
    id,
    chain_scope: chainScope,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    actor_type: input.actorType,
    actor_label: input.actorLabel ?? null,
    task_id: input.taskId ?? null,
    run_id: input.runId ?? null,
    payload_hash: payloadHash,
    payload_json: payloadJson,
    previous_event_hash: previousEventHash,
    chain_hash: chainHash,
    created_at: createdAt,
  });

  const row = db
    .prepare(`SELECT * FROM engineer_audit_events WHERE id = ?`)
    .get(id) as AuditEventRow;

  return mapRow(row);
}

/**
 * Append one audit event using BEGIN IMMEDIATE for same-process chain safety.
 */
export function appendAuditEvent(input: AppendAuditEventInput): AuditEventRecord {
  const db = getEngineerConsoleDb();
  const append = db.transaction((eventInput: AppendAuditEventInput) => appendWithinDb(db, eventInput));
  return append(input);
}

/** Fail-closed helper for lifecycle transitions that require an audit record. */
export function requireAuditEvent(input: AppendAuditEventInput): AuditEventRecord {
  return appendAuditEvent(input);
}
