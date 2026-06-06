import fs from "node:fs";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
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
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraImplementationArtifactPath,
  resolveVeraImplementationPatchProposalPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraImplementationPatchProposal } from "../worker/vera-implementation-patch-proposal-types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-proposal-types";

const DRAFT_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
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

export type VeraPatchContentDraftReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPatchContentDraftReadinessResult = {
  ok: boolean;
  safeToCreatePatchContentDraft: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPatchContentDraftReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  implementationArtifactPath: string | null;
  implementationArtifactHash: string | null;
  sourceProposalPath: string | null;
  sourceProposalHash: string | null;
  existingDraftPath: string | null;
  existingDraftHash: string | null;
  patchAlreadyApplied: boolean;
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraPatchContentDraftReadinessCheck[],
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

function resolveImplementationArtifactPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationArtifactPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationArtifactPath(runId);
}

function resolveProposalPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationPatchProposalPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationPatchProposalPath(runId);
}

function proposalSafetyIsValid(proposal: VeraImplementationPatchProposal): boolean {
  const safety = proposal.safety;
  return (
    safety.noPatchApplied === true &&
    safety.noCommitCreated === true &&
    safety.noPullRequestCreated === true &&
    safety.noMergePerformed === true &&
    safety.noDeploymentPerformed === true &&
    safety.noReleasePerformed === true
  );
}

function forbiddenReleaseAuditEvents(runId: string): string[] {
  return listAuditEventsForRun(runId)
    .filter((event) => DRAFT_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraPatchContentDraftReadiness(
  runId: string,
): VeraPatchContentDraftReadinessResult {
  const checks: VeraPatchContentDraftReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToCreatePatchContentDraft: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      implementationArtifactPath: null,
      implementationArtifactHash: null,
      sourceProposalPath: null,
      sourceProposalHash: null,
      existingDraftPath: null,
      existingDraftHash: null,
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
    "patch_proposal_approved_step",
    run.currentStep === VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP} before patch content draft creation.`,
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
    "Vera implementation artifact must be approved before patch content draft creation.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before patch content draft creation.",
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

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_patch_content_draft",
    !hasVeraImplementationPatchContentDraft(run.governanceNotes),
    "No prior Vera patch content draft exists.",
    "Vera patch content draft already exists for this run.",
  );

  const implementationArtifactPath = resolveImplementationArtifactPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "implementation_artifact_path_known",
    Boolean(implementationArtifactPath?.trim()),
    "Implementation artifact path is known.",
    "Implementation artifact path is missing.",
  );

  let implementationArtifactHash: string | null = null;
  const implementationExists = Boolean(
    implementationArtifactPath && fs.existsSync(implementationArtifactPath),
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "implementation_artifact_file_exists",
    implementationExists,
    "Implementation artifact file exists.",
    "Implementation artifact file is missing.",
  );

  const expectedImplementationHash =
    governanceNotes.veraImplementationArtifactHash?.trim() ?? null;
  if (implementationExists && implementationArtifactPath) {
    try {
      const content = fs.readFileSync(implementationArtifactPath, "utf8");
      implementationArtifactHash = hashArtifactContent(content);
      if (expectedImplementationHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "implementation_artifact_hash_matches",
          implementationArtifactHash === expectedImplementationHash,
          "Implementation artifact hash matches recorded governance value.",
          "Implementation artifact hash does not match recorded governance value.",
        );
      }
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "implementation_artifact_hash_readable",
        false,
        "Implementation artifact file is readable.",
        "Implementation artifact file could not be read for hash verification.",
      );
    }
  }

  const sourceProposalPath = resolveProposalPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "source_proposal_path_known",
    Boolean(sourceProposalPath?.trim()),
    "Source patch proposal path is known.",
    "Source patch proposal path is missing.",
  );

  const expectedProposalHash = governanceNotes.veraImplementationPatchProposalHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "source_proposal_hash_known",
    Boolean(expectedProposalHash),
    "Source patch proposal hash is recorded in governance notes.",
    "Source patch proposal hash is missing from governance notes.",
  );

  let sourceProposalHash: string | null = null;
  const proposalExists = Boolean(sourceProposalPath && fs.existsSync(sourceProposalPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "source_proposal_file_exists",
    proposalExists,
    "Source patch proposal file exists.",
    "Source patch proposal file is missing.",
  );

  if (proposalExists && sourceProposalPath) {
    try {
      const content = fs.readFileSync(sourceProposalPath, "utf8");
      sourceProposalHash = hashArtifactContent(content);
      if (expectedProposalHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "source_proposal_hash_matches",
          sourceProposalHash === expectedProposalHash,
          "Source patch proposal hash matches recorded governance value.",
          "Source patch proposal hash does not match recorded governance value.",
        );
      }

      const proposal = JSON.parse(content) as VeraImplementationPatchProposal;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "source_proposal_schema_version",
        proposal.schemaVersion === VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
        `Source patch proposal schema is ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
        `Source patch proposal schema must be ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "source_proposal_safety_flags",
        proposalSafetyIsValid(proposal),
        "Source patch proposal safety flags are valid.",
        "Source patch proposal safety flags are not in the expected state.",
      );
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "source_proposal_readable",
        false,
        "Source patch proposal file is readable.",
        "Source patch proposal file could not be read or parsed.",
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
    "No patch/commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden release audit events already exist: ${forbiddenEvents.join(", ")}.`,
  );

  const existingDraftPath = governanceNotes.veraImplementationPatchContentDraftPath ?? null;
  const existingDraftHash = governanceNotes.veraImplementationPatchContentDraftHash ?? null;

  return {
    ok: reasons.length === 0,
    safeToCreatePatchContentDraft: reasons.length === 0,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    implementationArtifactPath,
    implementationArtifactHash,
    sourceProposalPath,
    sourceProposalHash,
    existingDraftPath,
    existingDraftHash,
    patchAlreadyApplied,
    run,
    task,
    governanceNotes,
  };
}
