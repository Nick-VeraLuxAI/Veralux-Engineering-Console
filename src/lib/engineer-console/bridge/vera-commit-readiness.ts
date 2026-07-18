import fs from "node:fs";
import path from "node:path";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import {
  readCurrentBranchFromRepo,
  readHeadShaFromRepo,
} from "../governance/commit-candidate/governed-local-git";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  hasVeraCommit,
  hasVeraCommitProposal,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraCommitProposalPath,
  resolveVeraCommitReportPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraCommitProposal } from "../worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CREATE_CONFIRMATION,
  VERA_COMMIT_CREATE_PHASE_2W,
  VERA_COMMIT_PROPOSAL_PHASE_2V,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "../worker/vera-commit-proposal-types";
import type { VeraCommitReportValidationResult } from "../worker/vera-commit-report-types";

const COMMIT_CREATE_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
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
  AUDIT_EVENT_TYPES.VERA_COMMIT_CREATED,
]);

export type VeraCommitReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraCommitReadinessResult = {
  ok: boolean;
  safeToCreateCommit: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraCommitReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  commitProposalPath: string | null;
  commitProposalHash: string | null;
  targetRepoPath: string | null;
  branchName: string | null;
  parentHeadSha: string | null;
  proposedFiles: Array<{ path: string; sha256: string; status: string }>;
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraCommitReportValidationResult[];
  priorVeraCommitExists: boolean;
  forbiddenDownstreamEvents: string[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
  commitProposal: VeraCommitProposal | null;
};

function addCheck(
  checks: VeraCommitReadinessCheck[],
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

function hashRepoFile(repoPath: string, relativePath: string): string | null {
  const absolutePath = path.join(repoPath, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return hashArtifactContent(fs.readFileSync(absolutePath, "utf8"));
}

function collectExcludedDirtyFiles(
  repoPath: string,
  proposedPaths: Set<string>,
): string[] {
  const excluded = new Set<string>();
  const dirs = new Set<string>();
  for (const proposed of proposedPaths) {
    dirs.add(path.dirname(proposed));
  }
  for (const relDir of dirs) {
    const absDir = path.join(repoPath, relDir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(absDir)) {
      const rel = path.posix.join(relDir.replace(/\\/g, "/"), entry);
      const abs = path.join(repoPath, rel);
      if (!fs.statSync(abs).isFile()) continue;
      if (!proposedPaths.has(rel)) {
        excluded.add(rel);
      }
    }
  }
  return [...excluded].sort();
}

function forbiddenDownstreamAuditEvents(runId: string): string[] {
  return listAuditEventsForRun(runId)
    .filter((event) => COMMIT_CREATE_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraCommitReadiness(runId: string): VeraCommitReadinessResult {
  const checks: VeraCommitReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const validationResults: VeraCommitReportValidationResult[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  const empty = (
    overrides: Partial<VeraCommitReadinessResult> = {},
  ): VeraCommitReadinessResult => ({
    ok: false,
    safeToCreateCommit: false,
    reasonCodes: ["run_exists"],
    reasons: ["Run not found."],
    checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
    runId: trimmedRunId,
    taskId: "",
    veraWorkOrderId: null,
    commitProposalPath: null,
    commitProposalHash: null,
    targetRepoPath: null,
    branchName: null,
    parentHeadSha: null,
    proposedFiles: [],
    excludedDirtyFiles: [],
    dirtyWorkingTreeSummary:
      "Unrelated dirty files are intentionally excluded from this commit.",
    validationResults: [],
    priorVeraCommitExists: false,
    forbiddenDownstreamEvents: [],
    run: null,
    task: null,
    governanceNotes: {},
    commitProposal: null,
    ...overrides,
  });

  if (!run) {
    return empty();
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
    "commit_proposal_ready_step",
    run.currentStep === VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP} before Vera commit creation.`,
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
    "commit_proposal_governance_status",
    governanceNotes.veraCommitProposalStatus === "proposal_created",
    "Governance notes indicate veraCommitProposalStatus is proposal_created.",
    "Governance notes must indicate veraCommitProposalStatus is proposal_created.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_proposal_governance_marker",
    hasVeraCommitProposal(run.governanceNotes),
    "Commit proposal governance marker exists.",
    "Commit proposal governance marker is missing.",
  );

  const expectedProposalPath = governanceNotes.veraCommitProposalPath?.trim() || null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_proposal_path_known",
    Boolean(expectedProposalPath),
    "Governance notes include veraCommitProposalPath.",
    "Governance notes must include veraCommitProposalPath.",
  );

  const expectedProposalHash = governanceNotes.veraCommitProposalHash?.trim() || null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_proposal_hash_known",
    Boolean(expectedProposalHash),
    "Governance notes include veraCommitProposalHash.",
    "Governance notes must include veraCommitProposalHash.",
  );

  const priorVeraCommitExists = hasVeraCommit(run.governanceNotes);
  const commitReportPath = resolveVeraCommitReportPath(run.id);
  const commitReportFileExists = fs.existsSync(commitReportPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_prior_vera_commit",
    !priorVeraCommitExists && !commitReportFileExists,
    "No prior Vera commit has been created for this run.",
    "Vera commit already exists for this run.",
  );

  const commitProposalPath =
    expectedProposalPath || resolveVeraCommitProposalPath(run.id);
  const commitProposalExists = fs.existsSync(commitProposalPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_proposal_file_exists",
    commitProposalExists,
    "Commit proposal artifact exists.",
    "Commit proposal artifact is missing.",
  );

  let commitProposalHash: string | null = null;
  let commitProposal: VeraCommitProposal | null = null;
  let targetRepoPath: string | null = null;
  let parentHeadSha: string | null = null;
  let currentBranch: string | null = null;
  const proposedFiles: Array<{ path: string; sha256: string; status: string }> = [];
  let excludedDirtyFiles: string[] = [];
  let dirtyWorkingTreeSummary =
    "Unrelated dirty files are intentionally excluded from this commit.";

  if (commitProposalExists) {
    try {
      const content = fs.readFileSync(commitProposalPath, "utf8");
      commitProposalHash = hashArtifactContent(content);
      if (expectedProposalHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "commit_proposal_hash_matches",
          commitProposalHash === expectedProposalHash,
          "Commit proposal artifact hash matches governance.",
          "Commit proposal artifact hash does not match governance.",
        );
      }
      commitProposal = JSON.parse(content) as VeraCommitProposal;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_proposal_phase_2v",
        commitProposal.phase === VERA_COMMIT_PROPOSAL_PHASE_2V,
        "Commit proposal phase is 2V.",
        `Commit proposal phase must be 2V (current: ${String(commitProposal.phase)}).`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_proposal_next_gate_phase_2w",
        commitProposal.nextGate?.phase === VERA_COMMIT_CREATE_PHASE_2W,
        "Commit proposal nextGate.phase is 2W.",
        "Commit proposal nextGate.phase must be 2W.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_proposal_next_gate_confirmation",
        commitProposal.nextGate?.confirmationRequired === VERA_COMMIT_CREATE_CONFIRMATION,
        "Commit proposal nextGate.confirmationRequired is CREATE VERA COMMIT.",
        "Commit proposal nextGate.confirmationRequired must be CREATE VERA COMMIT.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "proposed_files_non_empty",
        Array.isArray(commitProposal.proposedFiles) &&
          commitProposal.proposedFiles.length > 0,
        "Commit proposal proposedFiles array is non-empty.",
        "Commit proposal proposedFiles array must be non-empty.",
      );
      targetRepoPath = commitProposal.targetRepoPath?.trim() || null;
      dirtyWorkingTreeSummary =
        commitProposal.dirtyWorkingTreeSummary?.trim() || dirtyWorkingTreeSummary;
      excludedDirtyFiles = Array.isArray(commitProposal.excludedDirtyFiles)
        ? [...commitProposal.excludedDirtyFiles]
        : [];
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_proposal_readable",
        false,
        "Commit proposal is readable.",
        "Commit proposal could not be read or parsed.",
      );
    }
  }

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_path_known",
    Boolean(targetRepoPath?.trim()),
    "Target repo path is known.",
    "Target repo path is missing.",
  );

  const targetRepoExists = Boolean(targetRepoPath && fs.existsSync(targetRepoPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_exists",
    targetRepoExists,
    "Target repo exists.",
    "Target repo does not exist.",
  );

  if (targetRepoPath && targetRepoExists) {
    try {
      currentBranch = readCurrentBranchFromRepo(targetRepoPath);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "target_branch_readable",
        Boolean(currentBranch),
        `Target branch is ${currentBranch}.`,
        "Could not read target branch.",
      );
    } catch (error) {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "target_branch_readable",
        false,
        "Target branch is readable.",
        error instanceof Error
          ? `Could not read target branch: ${error.message}`
          : "Could not read target branch.",
      );
    }

    addCheck(
      checks,
      reasonCodes,
      reasons,
      "target_branch_matches_run",
      Boolean(run.branchName?.trim()) && currentBranch === run.branchName,
      "Target branch matches run.branchName.",
      `Target branch must match run.branchName (${run.branchName ?? "null"}).`,
    );

    if (commitProposal?.branchName) {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "target_branch_matches_proposal",
        currentBranch === commitProposal.branchName,
        "Target branch matches commit proposal branchName.",
        "Target branch must match commit proposal branchName.",
      );
    }

    parentHeadSha = readHeadShaFromRepo(targetRepoPath);
    addCheck(
      checks,
      reasonCodes,
      reasons,
      "target_head_readable",
      Boolean(parentHeadSha?.trim()),
      "Target HEAD is readable.",
      "Target HEAD could not be read.",
    );

    if (commitProposal?.targetHeadSha && parentHeadSha) {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "target_head_matches_proposal",
        parentHeadSha === commitProposal.targetHeadSha,
        "Target HEAD before commit equals commitProposal.targetHeadSha.",
        "Target HEAD before commit must equal commitProposal.targetHeadSha.",
      );
    }
  }

  if (commitProposal && targetRepoPath && targetRepoExists) {
    const proposedPathSet = new Set<string>();
    for (const proposed of commitProposal.proposedFiles ?? []) {
      const filePath = proposed.path;
      proposedPathSet.add(filePath);
      const absolutePath = path.join(targetRepoPath, filePath);
      const exists = fs.existsSync(absolutePath);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `proposed_file_exists:${filePath}`,
        exists,
        `Proposed commit file exists on disk: ${filePath}`,
        `Proposed commit file is missing on disk: ${filePath}`,
      );

      const diskHash = exists ? hashRepoFile(targetRepoPath, filePath) : null;
      const expectedHash = proposed.sha256?.trim() || null;
      const hashOk = Boolean(diskHash) && Boolean(expectedHash) && diskHash === expectedHash;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `proposed_file_hash_matches:${filePath}`,
        hashOk,
        `Proposed file hash matches commit proposal: ${filePath}`,
        `Proposed file hash does not match commit proposal: ${filePath}`,
      );

      if (exists && diskHash && hashOk) {
        proposedFiles.push({
          path: filePath,
          sha256: diskHash,
          status: proposed.status,
        });
      }
    }

    const diskExcluded = collectExcludedDirtyFiles(targetRepoPath, proposedPathSet);
    excludedDirtyFiles = [...new Set([...excludedDirtyFiles, ...diskExcluded])].sort();
    validationResults.push({
      checkId: "exclude_unrelated_dirty_files",
      ok: true,
      message: `Excluded ${excludedDirtyFiles.length} unrelated dirty file(s) from staging.`,
    });
  }

  const forbiddenDownstreamEvents = forbiddenDownstreamAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_forbidden_downstream_events",
    forbiddenDownstreamEvents.length === 0,
    "No forbidden PR/merge/deploy/release/completion audit events exist.",
    `Forbidden downstream audit events already exist: ${forbiddenDownstreamEvents.join(", ")}.`,
  );

  for (const check of checks) {
    validationResults.push({
      checkId: check.id,
      ok: check.ok,
      message: check.message,
    });
  }

  const safeToCreateCommit =
    reasonCodes.length === 0 &&
    proposedFiles.length > 0 &&
    Boolean(targetRepoPath) &&
    Boolean(parentHeadSha) &&
    Boolean(commitProposal) &&
    Boolean(commitProposalHash);

  return {
    ok: safeToCreateCommit,
    safeToCreateCommit,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    commitProposalPath,
    commitProposalHash,
    targetRepoPath,
    branchName: run.branchName,
    parentHeadSha,
    proposedFiles,
    excludedDirtyFiles,
    dirtyWorkingTreeSummary,
    validationResults,
    priorVeraCommitExists,
    forbiddenDownstreamEvents,
    run,
    task,
    governanceNotes,
    commitProposal,
  };
}
