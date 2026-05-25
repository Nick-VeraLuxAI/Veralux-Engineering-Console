import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { getRunById } from "../../run-manager/run-manager";
import {
  AUDIT_ACTOR_TYPES,
  type AuditActorType,
} from "../audit-ledger/audit-event-types";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import {
  auditReviewStageApproved,
  auditReviewStageBlockedApproval,
  auditReviewStageRejected,
  auditReviewStageSkipped,
  auditReviewStagesCreated,
} from "../audit-ledger/review-audit-lifecycle";
import { getLatestPolicyResult } from "../policy-results/policy-result-manager";
import { determineRequiredReviewStages } from "./determine-required-review-stages";
import type {
  ReviewStageAction,
  ReviewStageGateResult,
  ReviewStageRecord,
  ReviewStageSummary,
} from "./review-stage-types";
import { ReviewStageError } from "./review-stage-types";

interface ReviewStageRow {
  id: string;
  run_id: string;
  task_id: string | null;
  stage: string;
  status: string;
  required: number;
  reason: string | null;
  reviewer_actor_type: string | null;
  reviewer_actor_label: string | null;
  reviewer_notes: string | null;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  policy_result_id: string | null;
  audit_event_id: string | null;
  audit_chain_hash: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: ReviewStageRow): ReviewStageRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    stage: row.stage as ReviewStageRecord["stage"],
    status: row.status as ReviewStageRecord["status"],
    required: row.required === 1,
    reason: row.reason,
    reviewerActorType: row.reviewer_actor_type,
    reviewerActorLabel: row.reviewer_actor_label,
    reviewerNotes: row.reviewer_notes,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    policyResultId: row.policy_result_id,
    auditEventId: row.audit_event_id,
    auditChainHash: row.audit_chain_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function listReviewStagesForRun(runId: string): ReviewStageRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_review_stages WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as ReviewStageRow[];
  return rows.map(mapRow);
}

export function getReviewStageById(stageId: string): ReviewStageRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_review_stages WHERE id = ?`)
    .get(stageId) as ReviewStageRow | undefined;
  return row ? mapRow(row) : null;
}

export function summarizeReviewStages(stages: ReviewStageRecord[]): ReviewStageSummary {
  const required = stages.filter((s) => s.required);
  return {
    requiredCount: required.length,
    approvedCount: required.filter((s) => s.status === "approved").length,
    rejectedCount: required.filter((s) => s.status === "rejected").length,
    pendingCount: required.filter((s) => s.status === "pending").length,
    skippedCount: stages.filter((s) => s.status === "skipped").length,
  };
}

export function verifyReviewStageGates(
  runId: string,
  options: { auditBlock?: boolean } = {},
): ReviewStageGateResult {
  const stages = listReviewStagesForRun(runId);
  const required = stages.filter((s) => s.required);
  const pendingRequired = required.filter((s) => s.status === "pending");
  const rejectedRequired = required.filter((s) => s.status === "rejected");

  if (pendingRequired.length === 0 && rejectedRequired.length === 0) {
    return { ok: true, pendingRequired: [], rejectedRequired: [], message: null };
  }

  const run = getRunById(runId);
  const message =
    rejectedRequired.length > 0
      ? `Approval blocked: required review stage(s) rejected (${rejectedRequired.map((s) => s.stage).join(", ")}).`
      : `Approval blocked: required review stage(s) pending (${pendingRequired.map((s) => s.stage).join(", ")}).`;

  if (options.auditBlock && run) {
    auditReviewStageBlockedApproval(runId, run.taskId, {
      pendingStages: pendingRequired.map((s) => s.stage),
      rejectedStages: rejectedRequired.map((s) => s.stage),
    });
  }

  return { ok: false, pendingRequired, rejectedRequired, message };
}

export function assertReviewStagesAllowApproval(runId: string): void {
  const gate = verifyReviewStageGates(runId, { auditBlock: true });
  if (!gate.ok) {
    throw new ReviewStageError(gate.message ?? "Review stage gate blocked approval.");
  }
}

export function reconcileReviewStagesForRun(
  runId: string,
  options: { audit?: boolean } = {},
): ReviewStageRecord[] {
  const run = getRunById(runId);
  if (!run) {
    throw new ReviewStageError(`Run not found: ${runId}`);
  }

  const specs = determineRequiredReviewStages(runId);
  const existing = listReviewStagesForRun(runId);
  const existingByStage = new Map(existing.map((s) => [s.stage, s]));
  const evidence = getEvidenceBundleForRun(runId);
  const policy = getLatestPolicyResult(runId);
  const now = nowIso();
  const created: ReviewStageRecord[] = [];

  for (const spec of specs) {
    const current = existingByStage.get(spec.stage);
    if (current) {
      if (
        current.status === "rejected" ||
        current.status === "approved" ||
        current.status === "skipped"
      ) {
        continue;
      }
      if (current.status === "pending" && current.reason !== spec.reason) {
        getEngineerConsoleDb()
          .prepare(
            `UPDATE engineer_review_stages SET reason = @reason, updated_at = @updated_at WHERE id = @id`,
          )
          .run({ id: current.id, reason: spec.reason, updated_at: now });
      }
      continue;
    }

    const id = uuidv4();
    getEngineerConsoleDb()
      .prepare(
        `INSERT INTO engineer_review_stages
          (id, run_id, task_id, stage, status, required, reason,
           evidence_bundle_id, evidence_bundle_hash, policy_result_id,
           created_at, updated_at)
         VALUES
          (@id, @run_id, @task_id, @stage, 'pending', @required, @reason,
           @evidence_bundle_id, @evidence_bundle_hash, @policy_result_id,
           @created_at, @updated_at)`,
      )
      .run({
        id,
        run_id: runId,
        task_id: run.taskId,
        stage: spec.stage,
        required: spec.required ? 1 : 0,
        reason: spec.reason,
        evidence_bundle_id: evidence?.id ?? null,
        evidence_bundle_hash: evidence?.bundleHash ?? null,
        policy_result_id: policy?.id ?? null,
        created_at: now,
        updated_at: now,
      });

    const row = getEngineerConsoleDb()
      .prepare(`SELECT * FROM engineer_review_stages WHERE id = ?`)
      .get(id) as ReviewStageRow;
    created.push(mapRow(row));
  }

  if (options.audit !== false && created.length > 0) {
    auditReviewStagesCreated(runId, run.taskId, {
      stageCount: created.length,
      requiredCount: created.filter((s) => s.required).length,
      stages: created.map((s) => s.stage),
    });
  }

  return listReviewStagesForRun(runId);
}

export function completeReviewStageAction(input: {
  stageId: string;
  action: ReviewStageAction;
  actorType: AuditActorType;
  actorLabel: string;
  rationale?: string | null;
}): ReviewStageRecord {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new ReviewStageError("Models cannot approve, reject, or skip review stages.");
  }

  const stage = getReviewStageById(input.stageId);
  if (!stage) {
    throw new ReviewStageError(`Review stage not found: ${input.stageId}`);
  }

  if (stage.status !== "pending") {
    throw new ReviewStageError(`Review stage ${stage.stage} is already ${stage.status}.`);
  }

  const notes = input.rationale?.trim() ?? "";
  if ((input.action === "reject" || input.action === "skip") && !notes) {
    throw new ReviewStageError("Rationale is required for reject and skip actions.");
  }

  if (input.action === "skip" && stage.required) {
    throw new ReviewStageError("Required review stages cannot be skipped.");
  }

  const run = getRunById(stage.runId);
  if (!run) {
    throw new ReviewStageError(`Run not found: ${stage.runId}`);
  }

  const evidence = getEvidenceBundleForRun(stage.runId);
  const now = nowIso();
  const newStatus =
    input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "skipped";

  let auditEvent;
  if (input.action === "approve") {
    auditEvent = auditReviewStageApproved(stage.runId, run.taskId, {
      stageId: stage.id,
      stage: stage.stage,
      required: stage.required,
      reason: stage.reason,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      evidenceBundleHashPrefix: evidence?.bundleHash.slice(0, 12) ?? null,
      policyResultId: stage.policyResultId,
    });
  } else if (input.action === "reject") {
    auditEvent = auditReviewStageRejected(stage.runId, run.taskId, {
      stageId: stage.id,
      stage: stage.stage,
      required: stage.required,
      reason: stage.reason,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      notes,
    });
  } else {
    auditEvent = auditReviewStageSkipped(stage.runId, run.taskId, {
      stageId: stage.id,
      stage: stage.stage,
      required: stage.required,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      notes,
    });
  }

  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_review_stages SET
        status = @status,
        reviewer_actor_type = @reviewer_actor_type,
        reviewer_actor_label = @reviewer_actor_label,
        reviewer_notes = @reviewer_notes,
        audit_event_id = @audit_event_id,
        audit_chain_hash = @audit_chain_hash,
        updated_at = @updated_at,
        completed_at = @completed_at
       WHERE id = @id`,
    )
    .run({
      id: stage.id,
      status: newStatus,
      reviewer_actor_type: input.actorType,
      reviewer_actor_label: input.actorLabel,
      reviewer_notes: notes || null,
      audit_event_id: auditEvent.id,
      audit_chain_hash: auditEvent.chainHash,
      updated_at: now,
      completed_at: now,
    });

  return getReviewStageById(stage.id)!;
}

export function toPublicReviewStage(record: ReviewStageRecord) {
  const policy = record.policyResultId ? getLatestPolicyResult(record.runId) : null;
  return {
    id: record.id,
    runId: record.runId,
    stage: record.stage,
    status: record.status,
    required: record.required,
    reason: record.reason,
    reviewerActorType: record.reviewerActorType,
    reviewerActorLabel: record.reviewerActorLabel,
    reviewerNotes: record.reviewerNotes,
    evidenceBundleHashPrefix: record.evidenceBundleHash?.slice(0, 12) ?? null,
    policyResultId: record.policyResultId,
    policyVersion: policy?.policyVersion ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}
