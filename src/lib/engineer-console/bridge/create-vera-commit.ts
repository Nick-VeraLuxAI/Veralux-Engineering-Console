import {
  auditVeraCommitCreateBlocked,
  auditVeraCommitCreateFailed,
  auditVeraCommitCreateRequested,
  auditVeraCommitCreated,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraCommitReadiness } from "./vera-commit-readiness";
import {
  hasVeraCommit,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  gitAddFile,
  gitCommit,
  gitDiffCachedNameOnly,
  gitRevParseHead,
} from "../governance/commit-candidate/governed-local-git";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import { writeVeraCommitReport } from "../worker/vera-implementation-artifact-storage";
import type { VeraCommitReport } from "../worker/vera-commit-report-types";
import {
  VERA_COMMIT_CONFIRMATION,
  VERA_COMMIT_PHASE_2W,
  VERA_COMMIT_REPORT_SCHEMA_VERSION,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARE_PHASE_2X,
} from "../worker/vera-commit-report-types";

export class VeraCommitError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: { status?: number; reasonCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "VeraCommitError";
    this.code = code;
    this.status = options.status ?? 400;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type CreateVeraCommitInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type CreateVeraCommitResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  commitReportPath: string;
  commitReportHash: string;
  commitSha: string;
  commitShaPrefix: string;
  parentHeadSha: string;
  committedFileCount: number;
  nextStep: string;
  warning: string;
};

function resolveCommitMessage(proposed: string | undefined): string {
  const message = proposed ?? "";
  if (!message || message.startsWith("-") || !message.trim()) {
    throw new VeraCommitError(
      "COMMIT_MESSAGE_INVALID",
      "Commit proposal proposedCommitMessage is empty or unsafe.",
      { status: 409, reasonCodes: ["COMMIT_MESSAGE_INVALID"] },
    );
  }
  return message;
}

/**
 * After staging proposed paths, ensure the index contains exactly those paths.
 * Exported for unit tests of the staged-diff guard.
 */
export async function assertStagedDiffMatchesProposedFiles(
  repoPath: string,
  proposedPaths: string[],
): Promise<string[]> {
  const staged = await gitDiffCachedNameOnly(repoPath);
  const allowed = new Set(proposedPaths);
  const unexpected = staged.filter((path) => !allowed.has(path));
  const missing = proposedPaths.filter((path) => !staged.includes(path));
  if (unexpected.length > 0 || missing.length > 0 || staged.length !== proposedPaths.length) {
    const parts: string[] = [];
    if (unexpected.length > 0) {
      parts.push(`Unexpected staged paths: ${unexpected.join(", ")}`);
    }
    if (missing.length > 0) {
      parts.push(`Missing staged paths: ${missing.join(", ")}`);
    }
    if (staged.length !== proposedPaths.length && unexpected.length === 0 && missing.length === 0) {
      parts.push(
        `Staged path count mismatch (staged=${staged.length}, proposed=${proposedPaths.length}).`,
      );
    }
    throw new VeraCommitError(
      "STAGED_DIFF_OUTSIDE_PROPOSAL",
      parts.join(" ") || "Staged diff does not match proposedFiles exactly.",
      { status: 409, reasonCodes: ["STAGED_DIFF_OUTSIDE_PROPOSAL"] },
    );
  }
  return staged;
}

export async function createVeraCommit(
  input: CreateVeraCommitInput,
): Promise<CreateVeraCommitResult> {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraCommitCreateBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraCommitError("NOT_FOUND", "Run not found.", { status: 404 });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraCommit(run.governanceNotes)) {
    auditVeraCommitCreateBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "VERA_COMMIT_ALREADY_CREATED",
      message: "Vera commit already created for this run.",
      commitProposalPath: governanceNotes.veraCommitProposalPath ?? null,
      commitProposalHash: governanceNotes.veraCommitProposalHash ?? null,
      commitReportPath: governanceNotes.veraCommitReportPath ?? null,
      commitReportHash: governanceNotes.veraCommitReportHash ?? null,
      commitSha: governanceNotes.veraCommitSha ?? null,
    });
    throw new VeraCommitError(
      "VERA_COMMIT_ALREADY_CREATED",
      "Vera commit already created for this run.",
      { status: 409 },
    );
  }

  const readiness = assessVeraCommitReadiness(run.id);

  auditVeraCommitCreateRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    commitProposalPath: readiness.commitProposalPath,
    commitProposalHash: readiness.commitProposalHash,
    note,
  });

  // Exact match only — no trim, no normalization, no case folding.
  if (input.confirmationText !== VERA_COMMIT_CONFIRMATION) {
    auditVeraCommitCreateBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_COMMIT_CONFIRMATION}`,
      commitProposalPath: readiness.commitProposalPath,
      commitProposalHash: readiness.commitProposalHash,
      reasonCodes: ["CONFIRMATION_INVALID"],
    });
    throw new VeraCommitError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_COMMIT_CONFIRMATION}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (
    !readiness.safeToCreateCommit ||
    !readiness.commitProposal ||
    !readiness.targetRepoPath ||
    !readiness.parentHeadSha ||
    !readiness.commitProposalPath ||
    !readiness.commitProposalHash ||
    !run.branchName
  ) {
    const message = readiness.reasons.join(" ");
    auditVeraCommitCreateBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      commitProposalPath: readiness.commitProposalPath,
      commitProposalHash: readiness.commitProposalHash,
    });
    throw new VeraCommitError("READINESS_FAILED", message, {
      status: 409,
      reasonCodes: readiness.reasonCodes,
    });
  }

  const proposal = readiness.commitProposal;
  const repoPath = readiness.targetRepoPath;
  const parentHeadSha = readiness.parentHeadSha;
  const proposedPaths = proposal.proposedFiles.map((file) => file.path);
  let commitMessage: string;
  try {
    commitMessage = resolveCommitMessage(proposal.proposedCommitMessage);
  } catch (error) {
    if (error instanceof VeraCommitError) {
      auditVeraCommitCreateBlocked(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: error.code,
        message: error.message,
        commitProposalPath: readiness.commitProposalPath,
        commitProposalHash: readiness.commitProposalHash,
        reasonCodes: error.reasonCodes,
      });
    }
    throw error;
  }

  try {
    for (const filePath of proposedPaths) {
      const addResult = await gitAddFile(repoPath, filePath);
      if (addResult.exitCode !== 0) {
        throw new VeraCommitError(
          "GIT_ADD_FAILED",
          addResult.stderr || `git add failed for ${filePath}`,
          { status: 500, reasonCodes: ["GIT_ADD_FAILED"] },
        );
      }
    }

    await assertStagedDiffMatchesProposedFiles(repoPath, proposedPaths);

    const commitResult = await gitCommit(repoPath, commitMessage);
    if (commitResult.exitCode !== 0) {
      throw new VeraCommitError(
        "GIT_COMMIT_FAILED",
        commitResult.stderr || "git commit failed",
        { status: 500, reasonCodes: ["GIT_COMMIT_FAILED"] },
      );
    }

    const commitSha = await gitRevParseHead(repoPath);
    const commitShaPrefix = commitSha.slice(0, 12);
    const createdAt = new Date().toISOString();
    const committedFiles = proposal.proposedFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
    }));
    const committedFileHashes = Object.fromEntries(
      committedFiles.map((file) => [file.path, file.sha256]),
    );

    const report: VeraCommitReport = {
      schemaVersion: VERA_COMMIT_REPORT_SCHEMA_VERSION,
      phase: VERA_COMMIT_PHASE_2W,
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
      createdAt,
      targetRepoPath: repoPath,
      branchName: run.branchName,
      parentHeadSha,
      commitSha,
      commitShaPrefix,
      commitMessage,
      sourceCommitProposalPath: readiness.commitProposalPath,
      sourceCommitProposalHash: readiness.commitProposalHash,
      committedFiles,
      committedFileHashes,
      excludedDirtyFiles: readiness.excludedDirtyFiles,
      dirtyWorkingTreeSummary: readiness.dirtyWorkingTreeSummary,
      validationResults: readiness.validationResults,
      createdBy: requestedBy,
      nextGate: {
        required: true,
        phase: VERA_PULL_REQUEST_PREPARE_PHASE_2X,
        confirmationRequired: VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
        note: "Human approval is required before preparing a pull request.",
      },
      safety: {
        stagedOnlyProposedFiles: true,
        noPushPerformed: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceCommitProposalHash: readiness.commitProposalHash,
        createdBy: requestedBy,
        tool: "vera-commit-create",
      },
    };

    const { commitReportPath, commitReportHash } = writeVeraCommitReport(report);

    const updated = updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
      completedAt: null,
      agentMessage:
        "Vera commit created. Pull request preparation remains separately gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraCommitStatus: "commit_created",
        veraCommitReportPath: commitReportPath,
        veraCommitReportHash: commitReportHash,
        veraCommitSha: commitSha,
        veraCommitShaPrefix: commitShaPrefix,
        veraCommitCreatedBy: requestedBy,
        veraCommitCreatedAt: createdAt,
        veraCommitFileCount: committedFiles.length,
        veraCommitSource: "commit_proposal",
      }),
    });

    if (!updated) {
      auditVeraCommitCreateFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera commit governance.",
        commitProposalPath: readiness.commitProposalPath,
        commitProposalHash: readiness.commitProposalHash,
      });
      throw new VeraCommitError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera commit governance.",
        { status: 500 },
      );
    }

    auditVeraCommitCreated(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      commitReportPath,
      commitReportHash,
      commitSha,
      commitShaPrefix,
      parentHeadSha,
      branchName: run.branchName,
      committedFileCount: committedFiles.length,
      commitProposalPath: readiness.commitProposalPath,
      commitProposalHash: readiness.commitProposalHash,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      commitReportPath,
      commitReportHash,
      commitSha,
      commitShaPrefix,
      parentHeadSha,
      committedFileCount: committedFiles.length,
      nextStep: VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
      warning:
        "This creates a local commit only. It stages only approved proposal files. It does not push, create PRs, merge, deploy, or release.",
    };
  } catch (error) {
    if (error instanceof VeraCommitError) {
      if (
        error.code === "STAGED_DIFF_OUTSIDE_PROPOSAL" ||
        error.code === "GIT_ADD_FAILED" ||
        error.code === "GIT_COMMIT_FAILED"
      ) {
        auditVeraCommitCreateBlocked(run.taskId, run.id, {
          requestedBy,
          veraWorkOrderId,
          reasonCode: error.code,
          message: error.message,
          commitProposalPath: readiness.commitProposalPath,
          commitProposalHash: readiness.commitProposalHash,
          reasonCodes: error.reasonCodes,
        });
      }
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Failed to create Vera commit.";
    auditVeraCommitCreateFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "VERA_COMMIT_CREATE_FAILED",
      message,
      commitProposalPath: readiness.commitProposalPath,
      commitProposalHash: readiness.commitProposalHash,
    });
    throw new VeraCommitError("VERA_COMMIT_CREATE_FAILED", message, { status: 500 });
  }
}
