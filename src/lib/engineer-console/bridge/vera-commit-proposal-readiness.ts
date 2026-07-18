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
  getVeraPostPatchQualityReportReviewDecision,
  hasVeraCommitProposal,
  hasVeraImplementationPatchApplication,
  hasVeraPostPatchQualityReport,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraCommitProposalPath,
  resolveVeraImplementationPatchApplicationPath,
  resolveVeraPostPatchQualityReportPath,
} from "../worker/vera-implementation-artifact-storage";
import type {
  VeraDraftSourcedPatchApplicationReport,
  VeraImplementationPatchApplicationReport,
  VeraPatchApplicationAppliedFile,
} from "../worker/vera-implementation-patch-application-types";
import type { VeraPostPatchQualityReport } from "../worker/vera-post-patch-quality-report-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP } from "../worker/vera-post-patch-quality-report-types";
import type {
  VeraCommitProposalFileStatus,
  VeraCommitProposalProposedFile,
  VeraCommitProposalValidationResult,
} from "../worker/vera-commit-proposal-types";

const COMMIT_PROPOSAL_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
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

export type VeraCommitProposalReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraCommitProposalReadinessResult = {
  ok: boolean;
  safeToPrepareCommitProposal: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraCommitProposalReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  applicationReportPath: string | null;
  applicationReportHash: string | null;
  qualityReportPath: string | null;
  qualityReportHash: string | null;
  approvedQualityReportHash: string | null;
  targetRepoPath: string | null;
  branchName: string | null;
  targetHeadSha: string | null;
  proposedFiles: VeraCommitProposalProposedFile[];
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraCommitProposalValidationResult[];
  priorCommitProposalExists: boolean;
  forbiddenDownstreamEvents: string[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
  applicationReport: VeraDraftSourcedPatchApplicationReport | null;
  qualityReport: VeraPostPatchQualityReport | null;
};

function addCheck(
  checks: VeraCommitProposalReadinessCheck[],
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

function isDraftSourcedApplicationReport(
  report: VeraImplementationPatchApplicationReport,
): report is VeraDraftSourcedPatchApplicationReport {
  return report.source === "patch_content_draft";
}

function resolveApplicationReportPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationPatchApplicationPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationPatchApplicationPath(runId);
}

function resolveQualityReportPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraPostPatchQualityReportPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraPostPatchQualityReportPath(runId);
}

function resolveTargetRepoPath(
  applicationReport: VeraDraftSourcedPatchApplicationReport | null,
  qualityReport: VeraPostPatchQualityReport | null,
): string | null {
  const fromApp = applicationReport?.worktreePath?.trim();
  if (fromApp) return fromApp;
  const fromQuality = qualityReport?.targetRepoPath?.trim();
  return fromQuality || null;
}

function mapActionToStatus(
  action: VeraPatchApplicationAppliedFile["action"],
): VeraCommitProposalFileStatus {
  return action === "created" ? "added" : "modified";
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
    .filter((event) => COMMIT_PROPOSAL_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraCommitProposalReadiness(
  runId: string,
): VeraCommitProposalReadinessResult {
  const checks: VeraCommitProposalReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const validationResults: VeraCommitProposalValidationResult[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  const empty = (
    overrides: Partial<VeraCommitProposalReadinessResult> = {},
  ): VeraCommitProposalReadinessResult => ({
    ok: false,
    safeToPrepareCommitProposal: false,
    reasonCodes: ["run_exists"],
    reasons: ["Run not found."],
    checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
    runId: trimmedRunId,
    taskId: "",
    veraWorkOrderId: null,
    applicationReportPath: null,
    applicationReportHash: null,
    qualityReportPath: null,
    qualityReportHash: null,
    approvedQualityReportHash: null,
    targetRepoPath: null,
    branchName: null,
    targetHeadSha: null,
    proposedFiles: [],
    excludedDirtyFiles: [],
    dirtyWorkingTreeSummary:
      "Unrelated dirty files are intentionally excluded from this proposal.",
    validationResults: [],
    priorCommitProposalExists: false,
    forbiddenDownstreamEvents: [],
    run: null,
    task: null,
    governanceNotes: {},
    applicationReport: null,
    qualityReport: null,
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
    "post_patch_quality_report_approved_step",
    run.currentStep === VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP} before commit proposal preparation.`,
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
    "patch_application_governance_marker",
    hasVeraImplementationPatchApplication(run.governanceNotes),
    "Patch application governance marker exists.",
    "Patch application governance marker is missing.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "post_patch_quality_report_governance_marker",
    hasVeraPostPatchQualityReport(run.governanceNotes),
    "Post-patch quality report governance marker exists.",
    "Post-patch quality report governance marker is missing.",
  );

  const reviewDecision = getVeraPostPatchQualityReportReviewDecision(run.governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_review_approved",
    reviewDecision === "approved",
    "Post-patch quality report review decision is approved.",
    "Post-patch quality report review decision must be approved.",
  );

  const priorCommitProposalExists = hasVeraCommitProposal(run.governanceNotes);
  const commitProposalPath = resolveVeraCommitProposalPath(run.id);
  const commitProposalFileExists = fs.existsSync(commitProposalPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_commit_proposal",
    !priorCommitProposalExists && !commitProposalFileExists,
    "No prior Vera commit proposal exists for this run.",
    "Vera commit proposal already exists for this run.",
  );

  const applicationReportPath = resolveApplicationReportPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "application_report_path_known",
    Boolean(applicationReportPath?.trim()),
    "Patch application report path is known.",
    "Patch application report path is missing.",
  );

  const expectedApplicationHash =
    governanceNotes.veraImplementationPatchApplicationHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "application_report_hash_known",
    Boolean(expectedApplicationHash),
    "Patch application report hash is recorded in governance notes.",
    "Patch application report hash is missing from governance notes.",
  );

  const applicationReportExists = Boolean(
    applicationReportPath && fs.existsSync(applicationReportPath),
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "application_report_file_exists",
    applicationReportExists,
    "Patch application report file exists.",
    "Patch application report file is missing.",
  );

  const qualityReportPath = resolveQualityReportPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_path_known",
    Boolean(qualityReportPath?.trim()),
    "Post-patch quality report path is known.",
    "Post-patch quality report path is missing.",
  );

  const expectedQualityHash = governanceNotes.veraPostPatchQualityReportHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_hash_known",
    Boolean(expectedQualityHash),
    "Post-patch quality report hash is recorded in governance notes.",
    "Post-patch quality report hash is missing from governance notes.",
  );

  const approvedQualityReportHash =
    governanceNotes.veraPostPatchQualityReportApprovedHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "approved_quality_report_hash_known",
    Boolean(approvedQualityReportHash),
    "Approved post-patch quality report hash is recorded.",
    "Approved post-patch quality report hash is missing.",
  );

  const qualityReportExists = Boolean(qualityReportPath && fs.existsSync(qualityReportPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_file_exists",
    qualityReportExists,
    "Post-patch quality report file exists.",
    "Post-patch quality report file is missing.",
  );

  let applicationReportHash: string | null = null;
  let qualityReportHash: string | null = null;
  let applicationReport: VeraDraftSourcedPatchApplicationReport | null = null;
  let qualityReport: VeraPostPatchQualityReport | null = null;
  const proposedFiles: VeraCommitProposalProposedFile[] = [];
  let excludedDirtyFiles: string[] = [];
  let dirtyWorkingTreeSummary =
    "Unrelated dirty files are intentionally excluded from this proposal.";
  let targetRepoPath: string | null = null;
  let targetHeadSha: string | null = null;
  let currentBranch: string | null = null;

  if (applicationReportExists && applicationReportPath) {
    try {
      const content = fs.readFileSync(applicationReportPath, "utf8");
      applicationReportHash = hashArtifactContent(content);
      if (expectedApplicationHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "application_report_hash_matches",
          applicationReportHash === expectedApplicationHash,
          "Patch application report hash matches recorded governance value.",
          "Patch application report hash does not match recorded governance value.",
        );
      }
      const parsed = JSON.parse(content) as VeraImplementationPatchApplicationReport;
      const draftSourced = isDraftSourcedApplicationReport(parsed);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "application_report_source_valid",
        draftSourced,
        "Patch application report source is patch_content_draft.",
        "Patch application report must be sourced from patch_content_draft.",
      );
      if (draftSourced) {
        applicationReport = parsed;
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "application_report_status_applied",
          parsed.status === "patch_applied",
          "Patch application report status is patch_applied.",
          "Patch application report status must be patch_applied.",
        );
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "application_report_has_applied_files",
          Array.isArray(parsed.appliedFiles) && parsed.appliedFiles.length > 0,
          "Patch application report lists applied files.",
          "Patch application report has no applied files.",
        );
      }
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "application_report_readable",
        false,
        "Patch application report is readable.",
        "Patch application report could not be read or parsed.",
      );
    }
  }

  if (qualityReportExists && qualityReportPath) {
    try {
      const content = fs.readFileSync(qualityReportPath, "utf8");
      qualityReportHash = hashArtifactContent(content);
      if (expectedQualityHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "quality_report_hash_matches",
          qualityReportHash === expectedQualityHash,
          "Post-patch quality report hash matches recorded governance value.",
          "Post-patch quality report hash does not match recorded governance value.",
        );
      }
      if (approvedQualityReportHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "approved_quality_report_hash_matches_current",
          qualityReportHash === approvedQualityReportHash,
          "Approved quality report hash equals the current post-patch quality report hash.",
          "Approved quality report hash does not equal the current post-patch quality report hash.",
        );
      }
      qualityReport = JSON.parse(content) as VeraPostPatchQualityReport;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_overall_status_passed",
        qualityReport.overallStatus === "passed",
        "Post-patch quality report overallStatus is passed.",
        `Post-patch quality report overallStatus must be passed (current: ${qualityReport.overallStatus}).`,
      );
      if (qualityReport.worktreeGitStatusSummary?.trim()) {
        dirtyWorkingTreeSummary = [
          qualityReport.worktreeGitStatusSummary.trim(),
          "Unrelated dirty files are intentionally excluded from this proposal.",
        ].join(" | ");
      }
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_readable",
        false,
        "Post-patch quality report is readable.",
        "Post-patch quality report could not be read or parsed.",
      );
    }
  }

  targetRepoPath = resolveTargetRepoPath(applicationReport, qualityReport);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_path_known",
    Boolean(targetRepoPath?.trim()),
    "Target worktree path is known.",
    "Target worktree path is missing.",
  );

  const targetRepoExists = Boolean(targetRepoPath && fs.existsSync(targetRepoPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_exists",
    targetRepoExists,
    "Target worktree path exists.",
    "Target worktree path does not exist.",
  );

  if (targetRepoPath && targetRepoExists) {
    try {
      currentBranch = readCurrentBranchFromRepo(targetRepoPath);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "worktree_branch_readable",
        Boolean(currentBranch),
        `Current worktree branch is ${currentBranch}.`,
        "Could not read current worktree branch.",
      );
    } catch (error) {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "worktree_branch_readable",
        false,
        "Current worktree branch is readable.",
        error instanceof Error
          ? `Could not read worktree branch: ${error.message}`
          : "Could not read worktree branch.",
      );
    }

    addCheck(
      checks,
      reasonCodes,
      reasons,
      "worktree_branch_matches_run",
      Boolean(run.branchName?.trim()) && currentBranch === run.branchName,
      "Worktree branch matches run.branchName.",
      `Worktree branch must match run.branchName (${run.branchName ?? "null"}).`,
    );

    targetHeadSha = readHeadShaFromRepo(targetRepoPath);
    addCheck(
      checks,
      reasonCodes,
      reasons,
      "target_head_sha_readable",
      Boolean(targetHeadSha?.trim()),
      "Target HEAD sha is readable without git subprocess.",
      "Target HEAD sha could not be read from .git refs.",
    );
  }

  if (
    applicationReport &&
    targetRepoPath &&
    targetRepoExists &&
    applicationReportHash &&
    qualityReportHash
  ) {
    const proposedPathSet = new Set<string>();
    for (const applied of applicationReport.appliedFiles) {
      const filePath = applied.filePath;
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
      const expectedHash = applied.afterHash?.trim() || null;
      const hashOk = Boolean(diskHash) && (!expectedHash || diskHash === expectedHash);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `proposed_file_hash_matches:${filePath}`,
        hashOk,
        `Proposed file hash matches application report evidence: ${filePath}`,
        `Proposed file hash does not match application report evidence: ${filePath}`,
      );

      if (qualityReport?.appliedFiles?.length) {
        const listed = qualityReport.appliedFiles.includes(filePath);
        addCheck(
          checks,
          reasonCodes,
          reasons,
          `proposed_file_in_quality_report:${filePath}`,
          listed,
          `Proposed file is listed in quality report appliedFiles: ${filePath}`,
          `Proposed file is missing from quality report appliedFiles: ${filePath}`,
        );
      }

      if (exists && diskHash && hashOk) {
        proposedFiles.push({
          path: filePath,
          status: mapActionToStatus(applied.action),
          sha256: diskHash,
          evidenceSource: "patch_application_report",
          applicationReportHash,
          qualityReportHash,
        });
      }
    }

    addCheck(
      checks,
      reasonCodes,
      reasons,
      "proposed_files_only_from_application_report",
      proposedFiles.length === applicationReport.appliedFiles.length &&
        proposedFiles.every((file) => proposedPathSet.has(file.path)),
      "Every proposed commit file comes only from the approved application report.",
      "Proposed commit files must come only from the approved application report applied files.",
    );

    excludedDirtyFiles = collectExcludedDirtyFiles(targetRepoPath, proposedPathSet);
    validationResults.push({
      checkId: "exclude_unrelated_dirty_files",
      ok: true,
      message: `Excluded ${excludedDirtyFiles.length} unrelated file(s) near approved applied paths.`,
    });
  }

  const forbiddenDownstreamEvents = forbiddenDownstreamAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_forbidden_downstream_events",
    forbiddenDownstreamEvents.length === 0,
    "No forbidden commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden downstream audit events already exist: ${forbiddenDownstreamEvents.join(", ")}.`,
  );

  for (const check of checks) {
    validationResults.push({
      checkId: check.id,
      ok: check.ok,
      message: check.message,
    });
  }

  const safeToPrepareCommitProposal =
    reasonCodes.length === 0 &&
    proposedFiles.length > 0 &&
    Boolean(targetRepoPath) &&
    Boolean(targetHeadSha) &&
    Boolean(applicationReport) &&
    Boolean(qualityReport);

  return {
    ok: safeToPrepareCommitProposal,
    safeToPrepareCommitProposal,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    applicationReportPath,
    applicationReportHash,
    qualityReportPath,
    qualityReportHash,
    approvedQualityReportHash,
    targetRepoPath,
    branchName: run.branchName,
    targetHeadSha,
    proposedFiles,
    excludedDirtyFiles,
    dirtyWorkingTreeSummary,
    validationResults,
    priorCommitProposalExists,
    forbiddenDownstreamEvents,
    run,
    task,
    governanceNotes,
    applicationReport,
    qualityReport,
  };
}
