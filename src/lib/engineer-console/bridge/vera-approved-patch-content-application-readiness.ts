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
  getVeraImplementationPatchContentDraftReviewDecision,
  getVeraImplementationPatchProposalReviewDecision,
  hasVeraImplementationPatchApplication,
  hasVeraImplementationPatchContentDraft,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { convertPatchContentDraftEntriesToApplicable } from "../worker/convert-patch-content-draft-entries";
import {
  hashArtifactContent,
  readVeraImplementationArtifactAtPath,
  resolveVeraImplementationArtifactPath,
  resolveVeraImplementationPatchApplicationPath,
  resolveVeraImplementationPatchContentDraftPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraApplicablePatchEntry } from "../worker/vera-implementation-patch-proposal-types";
import type { VeraImplementationPatchContentDraft } from "../worker/vera-implementation-patch-content-draft-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-content-draft-types";
import { validateApplicablePatchEntry } from "../worker/vera-patch-path-safety";

const APPLICATION_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
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

export type VeraApprovedPatchContentApplicationReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraApprovedPatchContentTargetFile = {
  filePath: string;
  action: string;
};

export type VeraApprovedPatchContentApplicationReadinessResult = {
  ok: boolean;
  safeToApplyApprovedPatchContent: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraApprovedPatchContentApplicationReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  draftPath: string | null;
  draftHash: string | null;
  entryCount: number;
  worktreePath: string | null;
  repoPath: string | null;
  branchName: string | null;
  targetFiles: VeraApprovedPatchContentTargetFile[];
  applicablePatchEntries: VeraApplicablePatchEntry[];
  applicationReportExists: boolean;
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraApprovedPatchContentApplicationReadinessCheck[],
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

function resolveImplementationArtifactPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationArtifactPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationArtifactPath(runId);
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

function forbiddenPriorPatchApplicationAuditEvents(events: AuditEventRecord[]): string[] {
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
      continue;
    }

    if (eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLIED) {
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
    .filter((event) => APPLICATION_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);

  return [...forbidden, ...forbiddenPriorPatchApplicationAuditEvents(events)];
}

function resolveWorktreePath(implementationArtifactPath: string | null): string | null {
  if (!implementationArtifactPath) return null;
  const artifact = readVeraImplementationArtifactAtPath(implementationArtifactPath);
  return artifact?.worktreePath?.trim() || artifact?.repoPath?.trim() || null;
}

function resolveRepoPath(implementationArtifactPath: string | null): string | null {
  if (!implementationArtifactPath) return null;
  const artifact = readVeraImplementationArtifactAtPath(implementationArtifactPath);
  return artifact?.repoPath?.trim() || artifact?.worktreePath?.trim() || null;
}

export function assessVeraApprovedPatchContentApplicationReadiness(
  runId: string,
): VeraApprovedPatchContentApplicationReadinessResult {
  const checks: VeraApprovedPatchContentApplicationReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToApplyApprovedPatchContent: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      draftPath: null,
      draftHash: null,
      entryCount: 0,
      worktreePath: null,
      repoPath: null,
      branchName: null,
      targetFiles: [],
      applicablePatchEntries: [],
      applicationReportExists: false,
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
    "patch_content_draft_approved_step",
    run.currentStep === VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP} before approved patch content application.`,
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
    "Vera implementation artifact must be approved before patch content application.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before patch content application.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_review_approved",
    getVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes) === "approved",
    "Vera patch content draft review decision is approved.",
    "Vera patch content draft must be approved before application.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_patch_application",
    !hasVeraImplementationPatchApplication(run.governanceNotes),
    "No prior Vera patch application exists.",
    "Vera patch application already exists for this run.",
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
  const applicationReportExists = fs.existsSync(applicationReportPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_patch_application_report",
    !applicationReportExists,
    "No patch application report exists.",
    "Patch application report already exists for this run.",
  );

  let draftHash: string | null = null;
  let parsedDraft: VeraImplementationPatchContentDraft | null = null;
  let applicablePatchEntries: VeraApplicablePatchEntry[] = [];
  let targetFiles: VeraApprovedPatchContentTargetFile[] = [];

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

      parsedDraft = JSON.parse(content) as VeraImplementationPatchContentDraft;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_schema_version",
        parsedDraft.schemaVersion === VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
        `Patch content draft schema is ${VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION}.`,
        `Patch content draft schema must be ${VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_status",
        parsedDraft.status === "draft_created",
        "Patch content draft status is draft_created.",
        "Patch content draft status must be draft_created.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_safety_flags",
        draftSafetyIsValid(parsedDraft),
        "Patch content draft safety flags are valid.",
        "Patch content draft safety flags are not in the expected state.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "patch_content_draft_has_entries",
        draftEntriesAreValid(parsedDraft),
        "Patch content draft has at least one valid patch entry.",
        "Patch content draft must include at least one valid patch entry.",
      );

      if (draftEntriesAreValid(parsedDraft)) {
        applicablePatchEntries = convertPatchContentDraftEntriesToApplicable(
          parsedDraft.patchEntries,
        );
        targetFiles = parsedDraft.patchEntries.map((entry) => ({
          filePath: entry.filePath,
          action: entry.action,
        }));
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
    "No prior patch application/commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden release audit events already exist: ${forbiddenEvents.join(", ")}.`,
  );

  const implementationArtifactPath = resolveImplementationArtifactPath(run.id, governanceNotes);
  const worktreePath = resolveWorktreePath(implementationArtifactPath);
  const repoPath = resolveRepoPath(implementationArtifactPath);
  const worktreeExists = Boolean(worktreePath && fs.existsSync(worktreePath));

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "worktree_path_known",
    Boolean(worktreePath?.trim()),
    "Governed worktree path is known from implementation artifact.",
    "Governed worktree path is missing from implementation artifact.",
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "worktree_path_exists",
    worktreeExists,
    "Governed worktree path exists.",
    "Governed worktree path does not exist.",
  );

  if (worktreeExists && worktreePath && applicablePatchEntries.length > 0) {
    for (const entry of applicablePatchEntries) {
      const validated = validateApplicablePatchEntry(entry, worktreePath);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `patch_entry_valid:${entry.filePath}`,
        validated.ok,
        `Patch entry is valid: ${entry.filePath}`,
        validated.ok ? `Patch entry is valid: ${entry.filePath}` : validated.reason,
      );
    }
  }

  if (worktreePath && run.branchName) {
    const artifact = implementationArtifactPath
      ? readVeraImplementationArtifactAtPath(implementationArtifactPath)
      : null;
    const artifactBranch = artifact?.branchName?.trim() ?? null;
    if (artifactBranch) {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "worktree_branch_matches_run",
        artifactBranch === run.branchName.trim(),
        "Implementation artifact branch matches run branch.",
        "Implementation artifact branch does not match run branch.",
      );
    }
  }

  return {
    ok: reasons.length === 0,
    safeToApplyApprovedPatchContent: reasons.length === 0,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    draftPath,
    draftHash,
    entryCount: applicablePatchEntries.length,
    worktreePath,
    repoPath,
    branchName: run.branchName,
    targetFiles,
    applicablePatchEntries,
    applicationReportExists,
    run,
    task,
    governanceNotes,
  };
}
