import { v4 as uuidv4 } from "uuid";
import type { ApprovalReport } from "../../types";
import { getEngineerConsoleDb } from "../../db/client";
import {
  getApprovalReportForRun,
  getQualityGateResultsForRun,
  getRunById,
} from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import {
  AUDIT_ACTOR_TYPES,
  type AuditActorType,
} from "../audit-ledger/audit-event-types";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import {
  auditDecisionRecordFailed,
  auditDecisionRecorded,
} from "./decision-audit-lifecycle";
import {
  buildDecisionSnapshot,
  redactDecisionSnapshot,
} from "./build-decision-snapshot";
import {
  DecisionRecordError,
  type CreateDecisionRecordInput,
  type DecisionRecord,
  type DecisionRecordRow,
  type DecisionValue,
} from "./decision-record-types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: DecisionRecordRow): DecisionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    decision: row.decision as DecisionValue,
    actorType: row.actor_type as AuditActorType,
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

function assertHumanCanApprove(decision: DecisionValue, actorType: AuditActorType): void {
  if (decision === "approved" && actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DecisionRecordError("Model actors cannot approve engineering runs.");
  }
}

/** Persist a human decision record and append DECISION_RECORDED audit event. Fail-closed on errors. */
export function createDecisionRecord(input: CreateDecisionRecordInput): DecisionRecord {
  assertHumanCanApprove(input.decision, input.actorType);

  const run = getRunById(input.runId);
  if (!run) {
    throw new DecisionRecordError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DecisionRecordError(`Task not found for run: ${input.runId}`);
  }

  const evidenceBundle = getEvidenceBundleForRun(input.runId);
  if (!evidenceBundle) {
    const err = new DecisionRecordError(
      `Evidence bundle missing for run ${input.runId}. Cannot record decision.`,
    );
    try {
      auditDecisionRecordFailed(input.runId, task.id, {
        decision: input.decision,
        message: err.message,
      });
    } catch {
      /* audit failure should not mask primary error */
    }
    throw err;
  }

  const approvalMeta = getApprovalReportForRun(input.runId);
  let approvalReport: { id: string; report: ApprovalReport } | null = null;
  if (approvalMeta) {
    approvalReport = {
      id: approvalMeta.id,
      report: JSON.parse(approvalMeta.reportJson) as ApprovalReport,
    };
  }

  const qualityGates = getQualityGateResultsForRun(input.runId);
  const recordedAt = nowIso();
  const snapshot = redactDecisionSnapshot(
    buildDecisionSnapshot({
      run,
      task,
      decision: input.decision,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      rationale: input.rationale,
      approvalReport,
      evidenceBundle,
      qualityGates,
      recordedAt,
    }),
  );

  const id = uuidv4();
  const rationale =
    input.rationale?.trim() ?
      input.rationale.trim().length > 2000 ?
        `${input.rationale.trim().slice(0, 2000)}…[truncated]`
      : input.rationale.trim()
    : null;

  let auditEventId: string | null = null;
  let auditChainHash: string | null = null;

  try {
    const auditEvent = auditDecisionRecorded(input.runId, task.id, id, {
      decision: input.decision,
      evidenceBundleHash: evidenceBundle.bundleHash,
      approvalReportId: approvalReport?.id ?? null,
      riskLevel: snapshot.governanceRiskLevel,
      qualityGateState: snapshot.qualityGateState,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
    });
    auditEventId = auditEvent.id;
    auditChainHash = auditEvent.chainHash;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditDecisionRecordFailed(input.runId, task.id, {
      decision: input.decision,
      message,
    });
    throw new DecisionRecordError(`Failed to append decision audit event: ${message}`);
  }

  const db = getEngineerConsoleDb();
  db.prepare(
    `INSERT INTO engineer_decision_records (
      id, run_id, task_id, decision, actor_type, actor_label, rationale,
      approval_report_id, evidence_bundle_id, evidence_bundle_hash,
      risk_level, can_approve, quality_gate_state,
      audit_event_id, audit_chain_hash, decision_snapshot_json, created_at
    ) VALUES (
      @id, @run_id, @task_id, @decision, @actor_type, @actor_label, @rationale,
      @approval_report_id, @evidence_bundle_id, @evidence_bundle_hash,
      @risk_level, @can_approve, @quality_gate_state,
      @audit_event_id, @audit_chain_hash, @decision_snapshot_json, @created_at
    )`,
  ).run({
    id,
    run_id: input.runId,
    task_id: task.id,
    decision: input.decision,
    actor_type: input.actorType,
    actor_label: input.actorLabel ?? null,
    rationale,
    approval_report_id: approvalReport?.id ?? null,
    evidence_bundle_id: evidenceBundle.id,
    evidence_bundle_hash: evidenceBundle.bundleHash,
    risk_level: snapshot.governanceRiskLevel,
    can_approve: snapshot.approvalCanApprove ? 1 : 0,
    quality_gate_state: snapshot.qualityGateState,
    audit_event_id: auditEventId,
    audit_chain_hash: auditChainHash,
    decision_snapshot_json: JSON.stringify(snapshot),
    created_at: recordedAt,
  });

  const row = db
    .prepare(`SELECT * FROM engineer_decision_records WHERE id = ?`)
    .get(id) as DecisionRecordRow;
  return mapRow(row);
}
