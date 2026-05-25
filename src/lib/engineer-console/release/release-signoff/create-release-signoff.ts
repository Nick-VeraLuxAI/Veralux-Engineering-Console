import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES, type AuditActorType } from "../../governance/audit-ledger/audit-event-types";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getLatestReleaseChecklistForRun } from "../release-checklist/release-checklist-manager";
import type { ReleaseChecklistStatus } from "../release-checklist/release-checklist-types";
import { buildReleaseSignoffSnapshot } from "./build-release-signoff-snapshot";
import {
  auditReleaseSignoffFailed,
  auditReleaseSignoffRecorded,
} from "./release-signoff-audit-lifecycle";
import { redactReleaseSignoffSnapshot } from "./sanitize-release-signoff-snapshot";
import type {
  ReleaseSignoffDecision,
  ReleaseSignoffRecord,
  ReleaseSignoffRow,
} from "./release-signoff-types";
import { ReleaseSignoffError } from "./release-signoff-types";
import {
  assertHardReleaseGateOrThrow,
  ReleaseGateError,
} from "../release-gates/release-gate-manager";
import {
  normalizeSignoffRationale,
  validateReleaseSignoffDecision,
} from "./validate-release-signoff-decision";

export interface CreateReleaseSignoffInput {
  runId: string;
  decision: ReleaseSignoffDecision;
  rationale?: string | null;
  actorType: AuditActorType;
  actorLabel?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createReleaseSignoff(input: CreateReleaseSignoffInput): ReleaseSignoffRecord {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new ReleaseSignoffError("Models cannot sign off on release completion.");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new ReleaseSignoffError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  const taskId = task?.id ?? null;

  try {
    const checklist = getLatestReleaseChecklistForRun(input.runId);
    if (!checklist) {
      throw new ReleaseSignoffError(
        "No persisted release checklist found. Evaluate the release checklist before signing off.",
      );
    }

    const checklistStatus = checklist.status as ReleaseChecklistStatus;
    const rationale = normalizeSignoffRationale(input.rationale);

    if (input.decision === "completed") {
      try {
        assertHardReleaseGateOrThrow(input.runId, "release_signoff_completed", {
          actorLabel: input.actorLabel?.trim() || "admin",
          context: { signoffRationale: rationale },
        });
      } catch (error) {
        if (error instanceof ReleaseGateError) {
          throw new ReleaseSignoffError(error.message);
        }
        throw error;
      }
    } else if (input.decision === "completed_with_exceptions") {
      try {
        assertHardReleaseGateOrThrow(input.runId, "release_signoff_completed_with_exceptions", {
          actorLabel: input.actorLabel?.trim() || "admin",
          context: { signoffRationale: rationale },
        });
      } catch (error) {
        if (error instanceof ReleaseGateError) {
          throw new ReleaseSignoffError(error.message);
        }
        throw error;
      }
    }

    validateReleaseSignoffDecision({
      decision: input.decision,
      checklistStatus,
      rationale,
    });

    const evidence = getEvidenceBundleForRun(input.runId);
    if (!evidence) {
      throw new ReleaseSignoffError(
        "Evidence bundle is required before release sign-off. Regenerate the evidence bundle first.",
      );
    }

    const signedOffAt = nowIso();
    const snapshot = redactReleaseSignoffSnapshot(
      buildReleaseSignoffSnapshot({
        runId: input.runId,
        decision: input.decision,
        rationale,
        signedOffAt,
        checklistId: checklist.id,
        checklistStatus,
      }),
    );

    const id = uuidv4();
    const actorLabel = input.actorLabel?.trim() || "admin";

    const auditEvent = auditReleaseSignoffRecorded(input.runId, taskId, {
      signoffId: id,
      decision: input.decision,
      checklistStatus,
      evidenceBundleHashPrefix: evidence.bundleHash.slice(0, 12),
      actorLabel,
    });

    getEngineerConsoleDb()
      .prepare(
        `INSERT INTO engineer_release_signoffs
          (id, run_id, release_checklist_id, release_checklist_status, decision,
           actor_type, actor_label, rationale, evidence_bundle_id, evidence_bundle_hash,
           audit_event_id, audit_chain_hash, signoff_snapshot_json, created_at)
         VALUES
          (@id, @run_id, @release_checklist_id, @release_checklist_status, @decision,
           @actor_type, @actor_label, @rationale, @evidence_bundle_id, @evidence_bundle_hash,
           @audit_event_id, @audit_chain_hash, @signoff_snapshot_json, @created_at)`,
      )
      .run({
        id,
        run_id: input.runId,
        release_checklist_id: checklist.id,
        release_checklist_status: checklistStatus,
        decision: input.decision,
        actor_type: input.actorType,
        actor_label: actorLabel,
        rationale,
        evidence_bundle_id: evidence.id,
        evidence_bundle_hash: evidence.bundleHash,
        audit_event_id: auditEvent.id,
        audit_chain_hash: auditEvent.chainHash,
        signoff_snapshot_json: JSON.stringify(snapshot),
        created_at: signedOffAt,
      });

    const row = getEngineerConsoleDb()
      .prepare(`SELECT * FROM engineer_release_signoffs WHERE id = ?`)
      .get(id) as ReleaseSignoffRow;

    return {
      id: row.id,
      runId: row.run_id,
      releaseChecklistId: row.release_checklist_id,
      releaseChecklistStatus: row.release_checklist_status,
      decision: row.decision as ReleaseSignoffRecord["decision"],
      actorType: row.actor_type as ReleaseSignoffRecord["actorType"],
      actorLabel: row.actor_label,
      rationale: row.rationale,
      evidenceBundleId: row.evidence_bundle_id,
      evidenceBundleHash: row.evidence_bundle_hash,
      auditEventId: row.audit_event_id,
      auditChainHash: row.audit_chain_hash,
      signoffSnapshotJson: row.signoff_snapshot_json,
      createdAt: row.created_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      auditReleaseSignoffFailed(input.runId, taskId, {
        decision: input.decision,
        message,
        actorLabel: input.actorLabel?.trim() || "admin",
      });
    } catch {
      /* do not mask primary error */
    }
    throw error instanceof ReleaseSignoffError
      ? error
      : new ReleaseSignoffError(message);
  }
}
