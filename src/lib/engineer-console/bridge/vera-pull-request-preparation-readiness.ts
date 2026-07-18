import fs from "node:fs";
import path from "node:path";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import {
  gitCommitDiffNameOnly,
  gitCommitExists,
  gitCommitParentSha,
  readCurrentBranchFromRepo,
  readHeadShaFromRepo,
} from "../governance/commit-candidate/governed-local-git";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  hasVeraCommit,
  hasVeraPullRequestPreparation,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraCommitReportPath,
  resolveVeraPullRequestPreparationPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraCommitReport } from "../worker/vera-commit-report-types";
import {
  VERA_COMMIT_PHASE_2W,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARE_PHASE_2X,
} from "../worker/vera-commit-report-types";
import type {
  VeraPullRequestPreparationFile,
  VeraPullRequestPreparationValidationResult,
} from "../worker/vera-pull-request-preparation-types";
import { VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH } from "../worker/vera-pull-request-preparation-types";

const PR_PREPARATION_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
  AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED,
  AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED,
  AUDIT_EVENT_TYPES.RUN_COMPLETED,
]);

export type VeraPullRequestPreparationReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPullRequestPreparationReadinessResult = {
  ok: boolean;
  safeToPreparePullRequest: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPullRequestPreparationReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  commitReportPath: string | null;
  commitReportHash: string | null;
  commitSha: string | null;
  parentHeadSha: string | null;
  targetRepoPath: string | null;
  branchName: string | null;
  baseBranch: string;
  headBranch: string | null;
  proposedPrFiles: VeraPullRequestPreparationFile[];
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraPullRequestPreparationValidationResult[];
  priorPullRequestPreparationExists: boolean;
  forbiddenDownstreamEvents: string[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
  commitReport: VeraCommitReport | null;
};

function addCheck(
  checks: VeraPullRequestPreparationReadinessCheck[],
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
    .filter((event) => PR_PREPARATION_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

function pathsEqualExact(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((path) => rightSet.has(path));
}

export async function assessVeraPullRequestPreparationReadiness(
  runId: string,
): Promise<VeraPullRequestPreparationReadinessResult> {
  const checks: VeraPullRequestPreparationReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const validationResults: VeraPullRequestPreparationValidationResult[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;
  const baseBranch = VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH;

  const empty = (
    overrides: Partial<VeraPullRequestPreparationReadinessResult> = {},
  ): VeraPullRequestPreparationReadinessResult => ({
    ok: false,
    safeToPreparePullRequest: false,
    reasonCodes: ["run_exists"],
    reasons: ["Run not found."],
    checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
    runId: trimmedRunId,
    taskId: "",
    veraWorkOrderId: null,
    commitReportPath: null,
    commitReportHash: null,
    commitSha: null,
    parentHeadSha: null,
    targetRepoPath: null,
    branchName: null,
    baseBranch,
    headBranch: null,
    proposedPrFiles: [],
    excludedDirtyFiles: [],
    dirtyWorkingTreeSummary:
      "Unrelated dirty files are intentionally excluded from this pull request preparation.",
    validationResults: [],
    priorPullRequestPreparationExists: false,
    forbiddenDownstreamEvents: [],
    run: null,
    task: null,
    governanceNotes: {},
    commitReport: null,
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
    "commit_created_step",
    run.currentStep === VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_COMMIT_CREATED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_COMMIT_CREATED_STEP} before pull request preparation.`,
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
    "commit_governance_status",
    governanceNotes.veraCommitStatus === "commit_created",
    "Governance notes indicate veraCommitStatus is commit_created.",
    "Governance notes must indicate veraCommitStatus is commit_created.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_governance_marker",
    hasVeraCommit(run.governanceNotes),
    "Vera commit governance marker exists.",
    "Vera commit governance marker is missing.",
  );

  const expectedCommitReportPath = governanceNotes.veraCommitReportPath?.trim() || null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_report_path_known",
    Boolean(expectedCommitReportPath),
    "Governance notes include veraCommitReportPath.",
    "Governance notes must include veraCommitReportPath.",
  );

  const expectedCommitReportHash = governanceNotes.veraCommitReportHash?.trim() || null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_report_hash_known",
    Boolean(expectedCommitReportHash),
    "Governance notes include veraCommitReportHash.",
    "Governance notes must include veraCommitReportHash.",
  );

  const expectedCommitSha = governanceNotes.veraCommitSha?.trim() || null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_sha_known",
    Boolean(expectedCommitSha),
    "Governance notes include veraCommitSha.",
    "Governance notes must include veraCommitSha.",
  );

  const priorPullRequestPreparationExists = hasVeraPullRequestPreparation(
    run.governanceNotes,
  );
  const preparationPath = resolveVeraPullRequestPreparationPath(run.id);
  const preparationFileExists = fs.existsSync(preparationPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_prior_pull_request_preparation",
    !priorPullRequestPreparationExists && !preparationFileExists,
    "No prior Vera pull request preparation exists for this run.",
    "Vera pull request preparation already exists for this run.",
  );

  const commitReportPath =
    expectedCommitReportPath || resolveVeraCommitReportPath(run.id);
  const commitReportExists = fs.existsSync(commitReportPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "commit_report_file_exists",
    commitReportExists,
    "Commit report artifact exists.",
    "Commit report artifact is missing.",
  );

  let commitReportHash: string | null = null;
  let commitReport: VeraCommitReport | null = null;
  let targetRepoPath: string | null = null;
  let commitSha: string | null = expectedCommitSha;
  let parentHeadSha: string | null = null;
  let currentBranch: string | null = null;
  const proposedPrFiles: VeraPullRequestPreparationFile[] = [];
  let excludedDirtyFiles: string[] = [];
  let dirtyWorkingTreeSummary =
    "Unrelated dirty files are intentionally excluded from this pull request preparation.";

  if (commitReportExists) {
    try {
      const content = fs.readFileSync(commitReportPath, "utf8");
      commitReportHash = hashArtifactContent(content);
      if (expectedCommitReportHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "commit_report_hash_matches",
          commitReportHash === expectedCommitReportHash,
          "Commit report artifact hash matches governance.",
          "Commit report artifact hash does not match governance.",
        );
      }
      commitReport = JSON.parse(content) as VeraCommitReport;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_report_phase_2w",
        commitReport.phase === VERA_COMMIT_PHASE_2W,
        "Commit report phase is 2W.",
        `Commit report phase must be 2W (current: ${String(commitReport.phase)}).`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_report_next_gate_phase_2x",
        commitReport.nextGate?.phase === VERA_PULL_REQUEST_PREPARE_PHASE_2X,
        "Commit report nextGate.phase is 2X.",
        "Commit report nextGate.phase must be 2X.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_report_next_gate_confirmation",
        commitReport.nextGate?.confirmationRequired ===
          VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
        "Commit report nextGate.confirmationRequired is PREPARE VERA PULL REQUEST.",
        "Commit report nextGate.confirmationRequired must be PREPARE VERA PULL REQUEST.",
      );
      targetRepoPath = commitReport.targetRepoPath?.trim() || null;
      parentHeadSha = commitReport.parentHeadSha?.trim() || null;
      if (!commitSha) {
        commitSha = commitReport.commitSha?.trim() || null;
      }
      dirtyWorkingTreeSummary =
        commitReport.dirtyWorkingTreeSummary?.trim() || dirtyWorkingTreeSummary;
      excludedDirtyFiles = Array.isArray(commitReport.excludedDirtyFiles)
        ? [...commitReport.excludedDirtyFiles]
        : [];
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_report_readable",
        false,
        "Commit report is readable.",
        "Commit report could not be read or parsed.",
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

    const headSha = readHeadShaFromRepo(targetRepoPath);
    addCheck(
      checks,
      reasonCodes,
      reasons,
      "target_head_matches_commit_sha",
      Boolean(headSha && expectedCommitSha && headSha === expectedCommitSha),
      "Target HEAD equals governance veraCommitSha.",
      "Target HEAD must equal governance veraCommitSha.",
    );

    if (commitSha) {
      const exists = await gitCommitExists(targetRepoPath, commitSha);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "commit_exists_in_target_repo",
        exists,
        "Commit exists in target repo.",
        "Commit does not exist in target repo.",
      );

      if (exists) {
        const actualParent = await gitCommitParentSha(targetRepoPath, commitSha);
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "commit_parent_matches_report",
          Boolean(parentHeadSha && actualParent === parentHeadSha),
          "Commit parent equals commit report parentHeadSha.",
          "Commit parent must equal commit report parentHeadSha.",
        );

        try {
          const diffPaths = await gitCommitDiffNameOnly(targetRepoPath, commitSha);
          const expectedPaths = (commitReport?.committedFiles ?? []).map((file) => file.path);
          addCheck(
            checks,
            reasonCodes,
            reasons,
            "commit_diff_matches_committed_files",
            pathsEqualExact(diffPaths, expectedPaths),
            "Commit diff contains only commitReport.committedFiles.",
            `Commit diff must contain only commitReport.committedFiles (diff=[${diffPaths.join(", ")}], expected=[${expectedPaths.join(", ")}]).`,
          );
        } catch (error) {
          addCheck(
            checks,
            reasonCodes,
            reasons,
            "commit_diff_readable",
            false,
            "Commit diff is readable.",
            error instanceof Error
              ? `Commit diff could not be read: ${error.message}`
              : "Commit diff could not be read.",
          );
        }
      }
    }
  }

  if (commitReport && targetRepoPath && targetRepoExists) {
    const proposedPathSet = new Set<string>();
    for (const committed of commitReport.committedFiles ?? []) {
      const filePath = committed.path;
      proposedPathSet.add(filePath);
      const absolutePath = path.join(targetRepoPath, filePath);
      const exists = fs.existsSync(absolutePath);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `committed_file_exists:${filePath}`,
        exists,
        `Committed file exists on disk: ${filePath}`,
        `Committed file is missing on disk: ${filePath}`,
      );

      const diskHash = exists ? hashRepoFile(targetRepoPath, filePath) : null;
      const expectedHash = committed.sha256?.trim() || null;
      const hashOk = Boolean(diskHash) && Boolean(expectedHash) && diskHash === expectedHash;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `committed_file_hash_matches:${filePath}`,
        hashOk,
        `Committed file hash matches commit report: ${filePath}`,
        `Committed file hash does not match commit report: ${filePath}`,
      );

      if (exists && diskHash && hashOk) {
        proposedPrFiles.push({ path: filePath, sha256: diskHash });
      }
    }

    const diskExcluded = collectExcludedDirtyFiles(targetRepoPath, proposedPathSet);
    excludedDirtyFiles = [...new Set([...excludedDirtyFiles, ...diskExcluded])].sort();
    validationResults.push({
      checkId: "exclude_unrelated_dirty_files",
      ok: true,
      message: `Excluded ${excludedDirtyFiles.length} unrelated dirty file(s) from PR preparation contents.`,
    });
  }

  const forbiddenDownstreamEvents = forbiddenDownstreamAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_forbidden_downstream_events",
    forbiddenDownstreamEvents.length === 0,
    "No forbidden PR-created/merge/deploy/release/completion audit events exist.",
    `Forbidden downstream audit events already exist: ${forbiddenDownstreamEvents.join(", ")}.`,
  );

  for (const check of checks) {
    validationResults.push({
      checkId: check.id,
      ok: check.ok,
      message: check.message,
    });
  }

  const safeToPreparePullRequest =
    reasonCodes.length === 0 &&
    proposedPrFiles.length > 0 &&
    Boolean(targetRepoPath) &&
    Boolean(commitSha) &&
    Boolean(parentHeadSha) &&
    Boolean(commitReport) &&
    Boolean(commitReportHash);

  return {
    ok: safeToPreparePullRequest,
    safeToPreparePullRequest,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    commitReportPath,
    commitReportHash,
    commitSha,
    parentHeadSha,
    targetRepoPath,
    branchName: run.branchName,
    baseBranch,
    headBranch: run.branchName,
    proposedPrFiles,
    excludedDirtyFiles,
    dirtyWorkingTreeSummary,
    validationResults,
    priorPullRequestPreparationExists,
    forbiddenDownstreamEvents,
    run,
    task,
    governanceNotes,
    commitReport,
  };
}
