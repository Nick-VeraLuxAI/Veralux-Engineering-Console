import fs from "node:fs";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import type { AuditEventRecord } from "../governance/audit-ledger/audit-ledger-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  getVeraImplementationArtifactReviewDecision,
  getVeraImplementationPatchProposalReviewDecision,
  hasVeraImplementationPatchApplication,
  hasVeraImplementationPatchContentDraft,
  hasVeraImplementationPatchContentDraftReviewDecision,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraImplementationPatchApplicationPath,
  resolveVeraImplementationPatchContentDraftPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraImplementationPatchContentDraft } from "../worker/vera-implementation-patch-content-draft-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-content-draft-types";

const REVIEW_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
  AUDIT_EVENT_TYPES.HERMES_PATCH_APPLY_REQUESTED,
  AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED,
  AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED,
  AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED,
  AUDIT_EVENT_TYPES.RUN_COMPLETED,
]);

const SAFE_NO_OP_PATCH_APPLICATION_BLOCKED_REASON = "NO_APPLICABLE_PATCH_CONTENT";

export type VeraPatchContentDraftReviewReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPatchContentDraftSummary = {
  entryCount: number;
  filePaths: string[];
  actions: string[];
};

export type VeraPatchContentDraftReviewReadinessResult = {
  ok: boolean;
  safeToReviewPatchContentDraft: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPatchContentDraftReviewReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  draftPath: string | null;
  draftHash: string | null;
  draftSummary: VeraPatchContentDraftSummary | null;
  priorReviewDecisionExists: boolean;
  patchAlreadyApplied: boolean;
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraPatchContentDraftReviewReadinessCheck[],
  reasonCodes: string[],
  reasons: string[],
  id: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
): void {
  checks.push({ id, ok, message: ok ? passMessage : failMessage });
  if (!ok) {
    reasonCodes.push(id);
    reasons.push(failMessage);
  }
}

function resolveDraftPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationPatchContentDraftPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationPatchContentDraftPath(runId);
}

function draftSafetyIsValid(draft: VeraImplementationPatchContentDraft): boolean {
  const safety = draft.safety;
  return (
    safety.noPatchApplied === true &&
    safety.noCommitCreated === true &&
    safety.noPullRequestCreated === true &&
    safety.noMergePerformed === true &&
    safety.noDeploymentPerformed === true &&
    safety.noReleasePerformed === true
  );
}

function draftEntriesAreValid(draft: VeraImplementationPatchContentDraft): boolean {
  if (!Array.isArray(draft.patchEntries) || draft.patchEntries.length === 0) return false;
  return draft.patchEntries.every(
    (entry) =>
      Boolean(entry.filePath?.trim()) &&
      (entry.action === "create" || entry.action === "modify") &&
      entry.patchIncluded === true &&
      Boolean(entry.patchContent?.trim()),
  );
}

function buildDraftSummary(draft: VeraImplementationPatchContentDraft): VeraPatchContentDraftSummary {
  return {
    entryCount: draft.patchEntries.length,
    filePaths: draft.patchEntries.map((entry) => entry.filePath),
    actions: draft.patchEntries.map((entry) => entry.action),
  };
}

function parseAuditPayload(event: AuditEventRecord): Record<string, unknown> {
  try {
    return JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isSafeNoOpPatchApplicationBlocked(payload: Record<string, unknown>): boolean {
  return (
    payload.reasonCode === SAFE_NO_OP_PATCH_APPLICATION_BLOCKED_REASON &&
    payload.noPatchApplied === true &&
    payload.noCommitCreated === true &&
    payload.noPullRequestCreated === true &&
    payload.noMergePerformed === true &&
    payload.noDeploymentPerformed === true &&
    payload.noReleasePerformed === true
  );
}

function forbiddenPatchApplicationAuditEvents(events: AuditEventRecord[]): string[] {
  const forbidden: string[] = [];
  let unresolvedRequestedCount = 0;

  for (const event of events) {
    const eventType = event.eventType;
    if (eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED) {
      unresolvedRequestedCount += 1;
      continue;
    }

    if (eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_BLOCKED) {
      const payload = parseAuditPayload(event);
      if (isSafeNoOpPatchApplicationBlocked(payload)) {
        if (unresolvedRequestedCount > 0) {
          unresolvedRequestedCount -= 1;
        }
      } else {
        forbidden.push(eventType);
      }
      continue;
    }

    if (eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED) {
      forbidden.push(eventType);
      continue;
    }

    if (eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_FAILED) {
      forbidden.push(eventType);
    }
  }

  if (unresolvedRequestedCount > 0) {
    forbidden.push(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED);
  }

  return forbidden;
}

function forbiddenReleaseAuditEvents(runId: string): string[] {
  const events = listAuditEventsForRun(runId);
  const forbidden = events
    .filter((event) => REVIEW_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);

  return [...forbidden, ...forbiddenPatchApplicationAuditEvents(events)];
}

export function assessVeraPatchContentDraftReviewReadiness(
  runId: string,
): VeraPatchContentDraftReviewReadinessResult {
  const checks: VeraPatchContentDraftReviewReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToReviewPatchContentDraft: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      draftPath: null,
      draftHash: null,
      draftSummary: null,
      priorReviewDecisionExists: false,
      patchAlreadyApplied: false,
      run: null,
      task: null,
      governanceNotes: {},
    };
  }

  const task = getTaskById(run.taskId);
  addCheck(checks, reasonCodes, reasons, "task_exists", Boolean(task), "Task exists.", "Task not found.");

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "vera_handoff_marker",
    governanceNotes.veraHandoff === true,
    "Run governance notes include veraHandoff marker.",
    "Run governance notes must include veraHandoff: true.",
  );

  const taskAnalysis = task ? analyzeVeraHandoffTask(task) : null;
  addCheck(
    checks,
    reasonCodes,
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
    reasonCodes,
    reasons,
    "vera_work_order_id",
    Boolean(veraWorkOrderId?.trim()),
    "Vera work order ID is present.",
    "Vera work order ID is missing.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "waiting_for_approval_status",
    run.status === "waiting_for_approval",
    "Run status is waiting_for_approval.",
    `Run status must be waiting_for_approval (current: ${run.status}).`,
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_ready_step",
    run.currentStep === VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP} before patch content draft review.`,
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "completed_at_null",
    run.completedAt === null,
    "Run completedAt is null.",
    "Run is already completed.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "artifact_review_approved",
    getVeraImplementationArtifactReviewDecision(run.governanceNotes) === "approved",
    "Vera implementation artifact review decision is approved.",
    "Vera implementation artifact must be approved before patch content draft review.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before patch content draft review.",
  );

  const priorReviewDecisionExists = hasVeraImplementationPatchContentDraftReviewDecision(
    run.governanceNotes,
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_patch_content_draft_review",
    !priorReviewDecisionExists,
    "No prior Vera patch content draft review decision exists.",
    "Vera patch content draft review decision already exists for this run.",
  );

  const patchAlreadyApplied = hasVeraImplementationPatchApplication(run.governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_prior_patch_application",
    !patchAlreadyApplied,
    "No prior Vera patch application exists.",
    "Vera patch has already been applied for this run.",
  );

  const draftPath = resolveDraftPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_path_known",
    Boolean(draftPath?.trim()),
    "Patch content draft path is known.",
    "Patch content draft path is missing.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_governance_marker",
    hasVeraImplementationPatchContentDraft(run.governanceNotes),
    "Patch content draft governance marker exists.",
    "Patch content draft governance marker is missing.",
  );

  const expectedDraftHash = governanceNotes.veraImplementationPatchContentDraftHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_hash_known",
    Boolean(expectedDraftHash),
    "Patch content draft hash is recorded in governance notes.",
    "Patch content draft hash is missing from governance notes.",
  );

  const draftExists = Boolean(draftPath && fs.existsSync(draftPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_file_exists",
    draftExists,
    "Patch content draft file exists.",
    "Patch content draft file is missing.",
  );

  const applicationReportPath = resolveVeraImplementationPatchApplicationPath(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_patch_application_report",
    !fs.existsSync(applicationReportPath),
    "No patch application report exists.",
    "Patch application report already exists for this run.",
  );

  let draftHash: string | null = null;
  let draftSummary: VeraPatchContentDraftSummary | null = null;

  if (draftExists && draftPath) {
    try {
      const content = fs.readFileSync(draftPath, "utf8");
      draftHash = hashArtifactContent(content);
      if (expectedDraftHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "patch_content_draft_hash_matches",
          draftHash === expectedDraftHash,
          "Patch content draft hash matches recorded governance value.",
          "Patch content draft hash does not match recorded governance value.",
        );
      }

      const draft = JSON.parse(content) as VeraImplementationPatchContentDraft;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_schema_version",
        draft.schemaVersion === VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
        `Patch content draft schema is ${VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION}.`,
        `Patch content draft schema must be ${VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_status",
        draft.status === "draft_created",
        "Patch content draft status is draft_created.",
        "Patch content draft status must be draft_created.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_safety_flags",
        draftSafetyIsValid(draft),
        "Patch content draft safety flags are valid.",
        "Patch content draft safety flags are not in the expected state.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_has_entries",
        draftEntriesAreValid(draft),
        "Patch content draft has at least one valid patch entry.",
        "Patch content draft must include at least one valid patch entry.",
      );

      if (draftEntriesAreValid(draft)) {
        draftSummary = buildDraftSummary(draft);
      }
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_readable",
        false,
        "Patch content draft file is readable.",
        "Patch content draft file could not be read or parsed.",
      );
    }
  }

  const forbiddenEvents = forbiddenReleaseAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_release_events",
    forbiddenEvents.length === 0,
    "No patch application/commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden release audit events already exist: ${forbiddenEvents.join(", ")}.`,
  );

  return {
    ok: reasons.length === 0,
    safeToReviewPatchContentDraft: reasons.length === 0,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    draftPath,
    draftHash,
    draftSummary,
    priorReviewDecisionExists,
    patchAlreadyApplied,
    run,
    task,
    governanceNotes,
  };
}
