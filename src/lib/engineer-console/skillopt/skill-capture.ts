import { resolveSkillOptFlags } from "./skill-flags";
import {
  extractSkillCandidatesFromRun,
  type AeRunEvidenceSlice,
} from "./candidate-extractor";
import { insertSkillCandidate } from "./skill-store";
import { shouldAutoRejectProposal, rejectSkill } from "./skill-curator";
import type { AutonomousDocument } from "../autonomous-engineer/types";
import type { SkillRecord } from "./skill-types";
import { auditAutonomousEvent } from "../autonomous-engineer/audit";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";

/**
 * Post-run capture: extract candidates from delivery evidence and store as candidates only.
 * Never validates automatically. Never mutates AE prompts/plans/QC.
 */
export function captureSkillsFromDeliveryEvidence(
  slice: AeRunEvidenceSlice,
): SkillRecord[] {
  const flags = resolveSkillOptFlags();
  if (!flags.capture) return [];

  const proposals = extractSkillCandidatesFromRun(slice);
  const stored: SkillRecord[] = [];
  for (const p of proposals) {
    try {
      const skill = insertSkillCandidate(p);
      const rejectReason = shouldAutoRejectProposal(p.lesson, p.title);
      if (
        rejectReason ||
        p.tags.includes("auto_reject_suggested") ||
        p.tags.includes("bad_candidate")
      ) {
        rejectSkill(
          skill.id,
          rejectReason ?? p.extractorNotes ?? "auto_reject_bad_candidate",
          "skillopt_capture",
        );
        stored.push({ ...skill, status: "rejected" });
      } else {
        stored.push(skill);
      }
    } catch {
      // Capture must not fail the AE run
    }
  }
  return stored;
}

/** Build a slice from an in-memory AutonomousDocument at terminal. */
export function sliceFromAutonomousDocument(
  runId: string,
  taskId: string,
  document: AutonomousDocument,
  evidencePath?: string,
): AeRunEvidenceSlice {
  return {
    runId,
    taskId,
    objective: document.originalObjective,
    deliveryCandidateStatus: document.deliveryCandidateStatus,
    primaryFailureCategory: document.failureClass,
    nanoRuntimeMode: document.nanoRuntimeMode ?? null,
    workerModel: document.workerModel
      ? { modelName: document.workerModel.modelName }
      : null,
    priorAttempts: document.priorAttempts.map((p) => ({
      summary: p.summary,
      failureClass: p.failureClass ?? undefined,
    })),
    failedHypotheses: document.failedHypotheses.map((h) => `${h.hypothesis}: ${h.whyFailed}`),
    qcDelta: document.qcDelta
      ? {
          objectiveQcPassed: document.qcDelta.objectiveQcPassed,
          summary: `new=${document.qcDelta.newFailures.length} owned=${document.qcDelta.ownedIterationFailures.length}`,
        }
      : null,
    reviews: document.reviews.map((r) => ({
      outcome: r.passed ? "pass" : "fail",
      defects: r.actionableDefects,
    })),
    acceptanceCriteria: document.acceptanceCriteria ?? [],
    evidencePath,
  };
}

export function maybeCaptureAfterAeTerminal(
  runId: string,
  taskId: string,
  document: AutonomousDocument,
): SkillRecord[] {
  const flags = resolveSkillOptFlags();
  if (!flags.capture) return [];
  try {
    const stored = captureSkillsFromDeliveryEvidence(
      sliceFromAutonomousDocument(runId, taskId, document),
    );
    auditAutonomousEvent(AUDIT_EVENT_TYPES.SKILLOPT_CAPTURE_COMPLETED, runId, taskId, {
      candidateCount: stored.length,
      statuses: stored.map((s) => s.status),
    });
    return stored;
  } catch {
    return [];
  }
}
