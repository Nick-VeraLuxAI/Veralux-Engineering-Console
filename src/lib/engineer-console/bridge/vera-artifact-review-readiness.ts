import fs from "node:fs";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  getVeraImplementationArtifactReviewDecision,
  hasVeraImplementationArtifactReviewDecision,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_READY_STEP } from "../worker/vera-implementation-artifact-types";
import {
  hashArtifactContent,
  resolveVeraImplementationArtifactPath,
} from "../worker/vera-implementation-artifact-storage";

const RELEASE_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
  AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED,
  AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED,
  AUDIT_EVENT_TYPES.RUN_COMPLETED,
]);

export type VeraArtifactReviewReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraArtifactReviewReadinessResult = {
  ok: boolean;
  safeToReviewArtifact: boolean;
  reasons: string[];
  checks: VeraArtifactReviewReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  artifactPath: string | null;
  artifactHash: string | null;
  expectedArtifactHash: string | null;
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraArtifactReviewReadinessCheck[],
  reasons: string[],
  id: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
): void {
  checks.push({ id, ok, message: ok ? passMessage : failMessage });
  if (!ok) reasons.push(failMessage);
}

function resolveArtifactPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationArtifactPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationArtifactPath(runId);
}

function hasForbiddenReleaseAuditEvents(runId: string): string[] {
  return listAuditEventsForRun(runId)
    .filter((event) => RELEASE_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraArtifactReviewReadiness(
  runId: string,
): VeraArtifactReviewReadinessResult {
  const checks: VeraArtifactReviewReadinessCheck[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToReviewArtifact: false,
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      artifactPath: null,
      artifactHash: null,
      expectedArtifactHash: null,
      run: null,
      task: null,
      governanceNotes: {},
    };
  }

  const task = getTaskById(run.taskId);
  addCheck(checks, reasons, "task_exists", Boolean(task), "Task exists.", "Task not found.");

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  addCheck(
    checks,
    reasons,
    "vera_handoff_marker",
    governanceNotes.veraHandoff === true,
    "Run governance notes include veraHandoff marker.",
    "Run governance notes must include veraHandoff: true.",
  );

  const taskAnalysis = task ? analyzeVeraHandoffTask(task) : null;
  addCheck(
    checks,
    reasons,
    "vera_task_handoff",
    taskAnalysis?.isVeraLuxOsHandoffTask === true,
    "Linked task is a VeraLux OS handoff.",
    "Linked task is not a VeraLux OS handoff.",
  );

  const veraWorkOrderId =
    governanceNotes.veraWorkOrderId ?? taskAnalysis?.veraWorkOrderId ?? null;
  addCheck(
    checks,
    reasons,
    "vera_work_order_id",
    Boolean(veraWorkOrderId?.trim()),
    "Vera work order ID is present.",
    "Vera work order ID is missing.",
  );

  addCheck(
    checks,
    reasons,
    "waiting_for_approval_status",
    run.status === "waiting_for_approval",
    "Run status is waiting_for_approval.",
    `Run status must be waiting_for_approval (current: ${run.status}).`,
  );

  addCheck(
    checks,
    reasons,
    "artifact_ready_step",
    run.currentStep === VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_ARTIFACT_READY_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_ARTIFACT_READY_STEP} before artifact review.`,
  );

  addCheck(
    checks,
    reasons,
    "completed_at_null",
    run.completedAt === null,
    "Run completedAt is null.",
    "Run is already completed.",
  );

  addCheck(
    checks,
    reasons,
    "no_existing_review_decision",
    !hasVeraImplementationArtifactReviewDecision(run.governanceNotes),
    "No prior Vera artifact review decision exists.",
    `Vera artifact review decision already recorded: ${getVeraImplementationArtifactReviewDecision(run.governanceNotes)}.`,
  );

  const artifactPath = resolveArtifactPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasons,
    "artifact_path_known",
    Boolean(artifactPath?.trim()),
    "Implementation artifact path is known.",
    "Implementation artifact path is missing.",
  );

  let artifactHash: string | null = null;
  const artifactExists = Boolean(artifactPath && fs.existsSync(artifactPath));
  addCheck(
    checks,
    reasons,
    "artifact_file_exists",
    artifactExists,
    "Implementation artifact file exists.",
    "Implementation artifact file is missing.",
  );

  const expectedArtifactHash = governanceNotes.veraImplementationArtifactHash?.trim() ?? null;
  if (artifactExists && artifactPath) {
    try {
      const content = fs.readFileSync(artifactPath, "utf8");
      artifactHash = hashArtifactContent(content);
      if (expectedArtifactHash) {
        addCheck(
          checks,
          reasons,
          "artifact_hash_matches",
          artifactHash === expectedArtifactHash,
          "Artifact hash matches recorded governance value.",
          "Artifact hash does not match recorded governance value.",
        );
      }
    } catch {
      addCheck(
        checks,
        reasons,
        "artifact_hash_readable",
        false,
        "Artifact file is readable.",
        "Implementation artifact file could not be read for hash verification.",
      );
    }
  }

  const forbiddenEvents = hasForbiddenReleaseAuditEvents(run.id);
  addCheck(
    checks,
    reasons,
    "no_release_events",
    forbiddenEvents.length === 0,
    "No PR/merge/deploy/release/completion audit events exist.",
    `Forbidden release audit events already exist: ${forbiddenEvents.join(", ")}.`,
  );

  return {
    ok: reasons.length === 0,
    safeToReviewArtifact: reasons.length === 0,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    artifactPath,
    artifactHash,
    expectedArtifactHash,
    run,
    task,
    governanceNotes,
  };
}
