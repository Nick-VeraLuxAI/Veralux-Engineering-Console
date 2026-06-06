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
  hasVeraImplementationPatchProposalReviewDecision,
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
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
  VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-proposal-types";

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

export type VeraPatchProposalApprovalReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPatchProposalApprovalReadinessResult = {
  ok: boolean;
  safeToReviewPatchProposal: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPatchProposalApprovalReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  implementationArtifactPath: string | null;
  implementationArtifactHash: string | null;
  proposalPath: string | null;
  proposalHash: string | null;
  proposalSummary: string | null;
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraPatchProposalApprovalReadinessCheck[],
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
    .filter((event) => REVIEW_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraPatchProposalApprovalReadiness(
  runId: string,
): VeraPatchProposalApprovalReadinessResult {
  const checks: VeraPatchProposalApprovalReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToReviewPatchProposal: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      implementationArtifactPath: null,
      implementationArtifactHash: null,
      proposalPath: null,
      proposalHash: null,
      proposalSummary: null,
      run: null,
      task: null,
      governanceNotes: {},
    };
  }

  const task = getTaskById(run.taskId);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "task_exists",
    Boolean(task),
    "Task exists.",
    "Task not found.",
  );

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
    "patch_proposal_ready_step",
    run.currentStep === VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP} before patch proposal review.`,
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
    "Vera implementation artifact must be approved before patch proposal review.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_proposal_review_decision",
    !hasVeraImplementationPatchProposalReviewDecision(run.governanceNotes),
    "No prior Vera patch proposal review decision exists.",
    `Vera patch proposal review decision already recorded: ${getVeraImplementationPatchProposalReviewDecision(run.governanceNotes)}.`,
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

  const proposalPath = resolveProposalPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_path_known",
    Boolean(proposalPath?.trim()),
    "Patch proposal path is known.",
    "Patch proposal path is missing.",
  );

  const expectedProposalHash = governanceNotes.veraImplementationPatchProposalHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_hash_known",
    Boolean(expectedProposalHash),
    "Patch proposal hash is recorded in governance notes.",
    "Patch proposal hash is missing from governance notes.",
  );

  let proposalHash: string | null = null;
  let proposalSummary: string | null = null;
  const proposalExists = Boolean(proposalPath && fs.existsSync(proposalPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_file_exists",
    proposalExists,
    "Patch proposal file exists.",
    "Patch proposal file is missing.",
  );

  if (proposalExists && proposalPath) {
    try {
      const content = fs.readFileSync(proposalPath, "utf8");
      proposalHash = hashArtifactContent(content);
      if (expectedProposalHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "proposal_hash_matches",
          proposalHash === expectedProposalHash,
          "Patch proposal hash matches recorded governance value.",
          "Patch proposal hash does not match recorded governance value.",
        );
      }

      const proposal = JSON.parse(content) as VeraImplementationPatchProposal;
      proposalSummary = proposal.summary?.trim() || null;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_schema_version",
        proposal.schemaVersion === VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
        `Patch proposal schema is ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
        `Patch proposal schema must be ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_status_created",
        proposal.status === "proposal_created",
        "Patch proposal status is proposal_created.",
        "Patch proposal status must be proposal_created.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_safety_flags",
        proposalSafetyIsValid(proposal),
        "Patch proposal safety flags confirm no patch/commit/PR/merge/deploy/release.",
        "Patch proposal safety flags are not in the expected non-mutation state.",
      );
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_readable",
        false,
        "Patch proposal file is readable.",
        "Patch proposal file could not be read or parsed.",
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

  return {
    ok: reasons.length === 0,
    safeToReviewPatchProposal: reasons.length === 0,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    implementationArtifactPath,
    implementationArtifactHash,
    proposalPath,
    proposalHash,
    proposalSummary,
    run,
    task,
    governanceNotes,
  };
}
