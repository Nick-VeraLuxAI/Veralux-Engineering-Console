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
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  readVeraImplementationArtifactAtPath,
  resolveVeraImplementationArtifactPath,
  resolveVeraImplementationPatchProposalPath,
} from "../worker/vera-implementation-artifact-storage";
import type {
  VeraApplicablePatchEntry,
  VeraImplementationPatchProposal,
} from "../worker/vera-implementation-patch-proposal-types";
import {
  extractApplicablePatchEntries,
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-proposal-types";
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

export type VeraPatchApplicationReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPatchApplicationReadinessResult = {
  ok: boolean;
  safeToApplyPatch: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPatchApplicationReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  implementationArtifactPath: string | null;
  implementationArtifactHash: string | null;
  proposalPath: string | null;
  proposalHash: string | null;
  worktreePath: string | null;
  applicablePatchCount: number;
  applicablePatchEntries: VeraApplicablePatchEntry[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraPatchApplicationReadinessCheck[],
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
    .filter((event) => APPLICATION_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

function resolveWorktreePath(
  implementationArtifactPath: string | null,
): string | null {
  if (!implementationArtifactPath) return null;
  const artifact = readVeraImplementationArtifactAtPath(implementationArtifactPath);
  return artifact?.worktreePath?.trim() || artifact?.repoPath?.trim() || null;
}

export function assessVeraPatchApplicationReadiness(
  runId: string,
): VeraPatchApplicationReadinessResult {
  const checks: VeraPatchApplicationReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToApplyPatch: false,
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
      worktreePath: null,
      applicablePatchCount: 0,
      applicablePatchEntries: [],
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
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP} before patch application.`,
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
    "Vera implementation artifact must be approved before patch application.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before patch application.",
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
  let parsedProposal: VeraImplementationPatchProposal | null = null;
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

      parsedProposal = JSON.parse(content) as VeraImplementationPatchProposal;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_schema_version",
        parsedProposal.schemaVersion === VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
        `Patch proposal schema is ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
        `Patch proposal schema must be ${VERA_PATCH_PROPOSAL_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_status_created",
        parsedProposal.status === "proposal_created",
        "Patch proposal status is proposal_created.",
        "Patch proposal status must be proposal_created.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposal_safety_flags",
        proposalSafetyIsValid(parsedProposal),
        "Patch proposal safety flags confirm no prior patch/commit/PR/merge/deploy/release.",
        "Patch proposal safety flags are not in the expected pre-application state.",
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

  const applicablePatchEntries = parsedProposal
    ? extractApplicablePatchEntries(parsedProposal)
    : [];
  const applicablePatchCount = applicablePatchEntries.length;

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "NO_APPLICABLE_PATCH_CONTENT",
    applicablePatchCount > 0,
    "Patch proposal contains explicit applicable patch entries.",
    "Patch proposal has no applicable patch content.",
  );

  const worktreePath = resolveWorktreePath(implementationArtifactPath);
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

  if (worktreeExists && worktreePath && applicablePatchCount > 0) {
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
    safeToApplyPatch: reasons.length === 0,
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
    worktreePath,
    applicablePatchCount,
    applicablePatchEntries,
    run,
    task,
    governanceNotes,
  };
}
