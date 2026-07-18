import {
  auditVeraPullRequestPreparationBlocked,
  auditVeraPullRequestPreparationCreated,
  auditVeraPullRequestPreparationFailed,
  auditVeraPullRequestPreparationRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPullRequestPreparationReadiness } from "./vera-pull-request-preparation-readiness";
import {
  hasVeraPullRequestPreparation,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import { writeVeraPullRequestPreparation } from "../worker/vera-implementation-artifact-storage";
import type { VeraPullRequestPreparation } from "../worker/vera-pull-request-preparation-types";
import {
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_CREATE_CONFIRMATION,
  VERA_PULL_REQUEST_CREATE_PHASE_2Y,
  VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH,
  VERA_PULL_REQUEST_DEFAULT_TITLE,
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARATION_PHASE_2X,
  VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
} from "../worker/vera-pull-request-preparation-types";

export class VeraPullRequestPreparationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: { status?: number; reasonCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "VeraPullRequestPreparationError";
    this.code = code;
    this.status = options.status ?? 400;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type PrepareVeraPullRequestInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type PrepareVeraPullRequestResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  preparationPath: string;
  preparationHash: string;
  proposedFileCount: number;
  commitSha: string;
  nextStep: string;
  warning: string;
};

export function buildVeraProposedPrBody(input: {
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  commitSha: string;
  sourceCommitReportHash: string;
  proposedPrFiles: Array<{ path: string }>;
}): string {
  const files = input.proposedPrFiles.map((file) => `- \`${file.path}\``).join("\n");
  return [
    "## Vera gated lifecycle recovery smoke",
    "",
    `- **runId:** \`${input.runId}\``,
    `- **taskId:** \`${input.taskId}\``,
    `- **veraWorkOrderId:** \`${input.veraWorkOrderId}\``,
    `- **commitSha:** \`${input.commitSha}\``,
    `- **sourceCommitReportHash:** \`${input.sourceCommitReportHash}\``,
    "",
    "### Committed files",
    "",
    files || "- (none)",
    "",
    "### Boundary",
    "",
    "This PR preparation does not push, create PRs, merge, deploy, release, or complete the run.",
  ].join("\n");
}

export async function prepareVeraPullRequest(
  input: PrepareVeraPullRequestInput,
): Promise<PrepareVeraPullRequestResult> {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraPullRequestPreparationBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraPullRequestPreparationError("NOT_FOUND", "Run not found.", {
      status: 404,
    });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraPullRequestPreparation(run.governanceNotes)) {
    auditVeraPullRequestPreparationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "VERA_PULL_REQUEST_PREPARATION_ALREADY_EXISTS",
      message: "Vera pull request preparation already exists for this run.",
      commitReportPath: governanceNotes.veraCommitReportPath ?? null,
      commitReportHash: governanceNotes.veraCommitReportHash ?? null,
      preparationPath: governanceNotes.veraPullRequestPreparationPath ?? null,
      preparationHash: governanceNotes.veraPullRequestPreparationHash ?? null,
      commitSha: governanceNotes.veraCommitSha ?? null,
    });
    throw new VeraPullRequestPreparationError(
      "VERA_PULL_REQUEST_PREPARATION_ALREADY_EXISTS",
      "Vera pull request preparation already exists for this run.",
      { status: 409 },
    );
  }

  const readiness = await assessVeraPullRequestPreparationReadiness(run.id);

  auditVeraPullRequestPreparationRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    commitReportPath: readiness.commitReportPath,
    commitReportHash: readiness.commitReportHash,
    commitSha: readiness.commitSha,
    note,
  });

  // Exact match only — no trim, no normalization, no case folding.
  if (input.confirmationText !== VERA_PULL_REQUEST_PREPARATION_CONFIRMATION) {
    auditVeraPullRequestPreparationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_PULL_REQUEST_PREPARATION_CONFIRMATION}`,
      commitReportPath: readiness.commitReportPath,
      commitReportHash: readiness.commitReportHash,
      commitSha: readiness.commitSha,
      reasonCodes: ["CONFIRMATION_INVALID"],
    });
    throw new VeraPullRequestPreparationError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_PULL_REQUEST_PREPARATION_CONFIRMATION}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (
    !readiness.safeToPreparePullRequest ||
    !readiness.commitReport ||
    !readiness.targetRepoPath ||
    !readiness.commitSha ||
    !readiness.parentHeadSha ||
    !readiness.commitReportPath ||
    !readiness.commitReportHash ||
    !run.branchName
  ) {
    const message = readiness.reasons.join(" ");
    auditVeraPullRequestPreparationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      commitReportPath: readiness.commitReportPath,
      commitReportHash: readiness.commitReportHash,
      commitSha: readiness.commitSha,
    });
    throw new VeraPullRequestPreparationError("READINESS_FAILED", message, {
      status: 409,
      reasonCodes: readiness.reasonCodes,
    });
  }

  const createdAt = new Date().toISOString();
  const commitSha = readiness.commitSha;
  const commitShaPrefix = commitSha.slice(0, 12);
  const proposedPrTitle = VERA_PULL_REQUEST_DEFAULT_TITLE;
  const proposedPrBody = buildVeraProposedPrBody({
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
    commitSha,
    sourceCommitReportHash: readiness.commitReportHash,
    proposedPrFiles: readiness.proposedPrFiles,
  });

  const preparation: VeraPullRequestPreparation = {
    schemaVersion: VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
    phase: VERA_PULL_REQUEST_PREPARATION_PHASE_2X,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
    createdAt,
    targetRepoPath: readiness.targetRepoPath,
    branchName: run.branchName,
    sourceCommitReportPath: readiness.commitReportPath,
    sourceCommitReportHash: readiness.commitReportHash,
    commitSha,
    commitShaPrefix,
    parentHeadSha: readiness.parentHeadSha,
    baseBranch: readiness.baseBranch || VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH,
    headBranch: run.branchName,
    proposedPrTitle,
    proposedPrBody,
    proposedPrFiles: readiness.proposedPrFiles,
    excludedDirtyFiles: readiness.excludedDirtyFiles,
    dirtyWorkingTreeSummary: readiness.dirtyWorkingTreeSummary,
    validationResults: readiness.validationResults,
    nextGate: {
      required: true,
      phase: VERA_PULL_REQUEST_CREATE_PHASE_2Y,
      confirmationRequired: VERA_PULL_REQUEST_CREATE_CONFIRMATION,
      note: "Human approval is required before creating a pull request.",
    },
    safety: {
      noStagingPerformed: true,
      noCommitCreated: true,
      noPushPerformed: true,
      noGitHubCalled: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
    },
    provenance: {
      sourceCommitReportHash: readiness.commitReportHash,
      preparedBy: requestedBy,
      tool: "vera-pull-request-preparation",
    },
  };

  try {
    const { preparationPath, preparationHash } =
      writeVeraPullRequestPreparation(preparation);

    const updated = updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
      completedAt: null,
      agentMessage:
        "Vera pull request preparation is ready. Pull request creation remains separately gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraPullRequestPreparationStatus: "preparation_created",
        veraPullRequestPreparationPath: preparationPath,
        veraPullRequestPreparationHash: preparationHash,
        veraPullRequestPreparationCreatedBy: requestedBy,
        veraPullRequestPreparationCreatedAt: createdAt,
        veraPullRequestPreparationFileCount: preparation.proposedPrFiles.length,
        veraPullRequestPreparationSource: "commit_report",
        veraPullRequestPreparationCommitSha: commitSha,
      }),
    });

    if (!updated) {
      auditVeraPullRequestPreparationFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera pull request preparation governance.",
        commitReportPath: readiness.commitReportPath,
        commitReportHash: readiness.commitReportHash,
        commitSha,
      });
      throw new VeraPullRequestPreparationError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera pull request preparation governance.",
        { status: 500 },
      );
    }

    auditVeraPullRequestPreparationCreated(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      preparationPath,
      preparationHash,
      commitReportPath: readiness.commitReportPath,
      commitReportHash: readiness.commitReportHash,
      commitSha,
      proposedFileCount: preparation.proposedPrFiles.length,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      preparationPath,
      preparationHash,
      proposedFileCount: preparation.proposedPrFiles.length,
      commitSha,
      nextStep: VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
      warning:
        "This prepares pull request metadata only. It does not push, call GitHub, create PRs, merge, deploy, or release.",
    };
  } catch (error) {
    if (error instanceof VeraPullRequestPreparationError) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Failed to prepare Vera pull request.";
    auditVeraPullRequestPreparationFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PULL_REQUEST_PREPARATION_WRITE_FAILED",
      message,
      commitReportPath: readiness.commitReportPath,
      commitReportHash: readiness.commitReportHash,
      commitSha: readiness.commitSha,
    });
    throw new VeraPullRequestPreparationError(
      "PULL_REQUEST_PREPARATION_WRITE_FAILED",
      message,
      { status: 500 },
    );
  }
}
