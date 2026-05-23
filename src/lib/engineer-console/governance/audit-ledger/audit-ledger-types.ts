import type { AuditActorType, AuditEntityType, AuditEventType } from "./audit-event-types";

export const AUDIT_CHAIN_GENESIS = "GENESIS" as const;

export const DEFAULT_AUDIT_CHAIN_SCOPE = "global";

export function resolveAuditChainScope(): string {
  return process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE?.trim() || DEFAULT_AUDIT_CHAIN_SCOPE;
}

export interface AuditEventRecord {
  id: string;
  chainScope: string;
  eventType: AuditEventType | string;
  entityType: AuditEntityType | string;
  entityId: string;
  actorType: AuditActorType | string;
  actorLabel: string | null;
  taskId: string | null;
  runId: string | null;
  payloadHash: string;
  payloadJson: string;
  previousEventHash: string | null;
  chainHash: string;
  createdAt: string;
}

export interface AuditEventRow {
  id: string;
  chain_scope: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_label: string | null;
  task_id: string | null;
  run_id: string | null;
  payload_hash: string;
  payload_json: string;
  previous_event_hash: string | null;
  chain_hash: string;
  created_at: string;
}

export interface AppendAuditEventInput {
  chainScope?: string;
  eventType: AuditEventType | string;
  entityType: AuditEntityType | string;
  entityId: string;
  actorType: AuditActorType | string;
  actorLabel?: string | null;
  taskId?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown>;
}

export interface AuditChainVerificationResult {
  ok: boolean;
  checkedCount: number;
  failures: string[];
}

export class AuditLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLedgerError";
  }
}
