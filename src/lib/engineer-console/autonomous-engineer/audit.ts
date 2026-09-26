import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
} from "../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../governance/audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../governance/audit-ledger/audit-ledger-types";

function systemEvent(
  input: Omit<Parameters<typeof requireAuditEvent>[0], "actorType">,
): AuditEventRecord {
  return requireAuditEvent({ ...input, actorType: AUDIT_ACTOR_TYPES.SYSTEM });
}

export function auditAutonomousEvent(
  eventType: string,
  runId: string,
  taskId: string,
  payload: Record<string, unknown> = {},
): AuditEventRecord {
  return systemEvent({
    eventType,
    entityType: AUDIT_ENTITY_TYPES.AUTONOMOUS_ENGINEER,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}
