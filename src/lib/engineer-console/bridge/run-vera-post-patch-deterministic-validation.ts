import fs from "node:fs";
import path from "node:path";
import { readCurrentBranchFromRepo } from "../governance/commit-candidate/governed-local-git";
import { hashArtifactContent } from "../worker/vera-implementation-artifact-storage";
import type { VeraDraftSourcedPatchApplicationReport } from "../worker/vera-implementation-patch-application-types";
import type {
  VeraPostPatchQualityGateResult,
  VeraPostPatchQualityGateStatus,
} from "../worker/vera-post-patch-quality-report-types";

function hashRepoFile(repoPath: string, relativePath: string): string | null {
  const absolutePath = path.join(repoPath, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return hashArtifactContent(fs.readFileSync(absolutePath, "utf8"));
}

function summarizeOverallStatus(
  gateResults: VeraPostPatchQualityGateResult[],
): VeraPostPatchQualityGateStatus {
  if (gateResults.some((gate) => gate.status === "blocked")) return "blocked";
  if (gateResults.some((gate) => gate.status === "failed")) return "failed";
  return "passed";
}

export function runVeraPostPatchDeterministicValidation(input: {
  applicationReport: VeraDraftSourcedPatchApplicationReport;
  applicationReportHash: string;
  targetRepoPath: string;
  branchName: string | null;
}): {
  gateResults: VeraPostPatchQualityGateResult[];
  overallStatus: VeraPostPatchQualityGateStatus;
  changedFiles: string[];
  appliedFiles: string[];
  worktreeGitStatusSummary: string;
  gateSummary: string;
} {
  const gateResults: VeraPostPatchQualityGateResult[] = [];
  const { applicationReport, applicationReportHash, targetRepoPath, branchName } = input;

  gateResults.push({
    gateId: "application_source_patch_content_draft",
    status: applicationReport.source === "patch_content_draft" ? "passed" : "failed",
    message:
      applicationReport.source === "patch_content_draft"
        ? "Application report source is patch_content_draft."
        : "Application report source must be patch_content_draft.",
  });

  gateResults.push({
    gateId: "application_status_patch_applied",
    status: applicationReport.status === "patch_applied" ? "passed" : "failed",
    message:
      applicationReport.status === "patch_applied"
        ? "Application report status is patch_applied."
        : "Application report status must be patch_applied.",
  });

  gateResults.push({
    gateId: "application_report_hash_recorded",
    status: Boolean(applicationReportHash.trim()) ? "passed" : "failed",
    message: applicationReportHash.trim()
      ? "Application report hash is recorded."
      : "Application report hash is missing.",
    details: { applicationReportHash },
  });

  const appliedFiles = applicationReport.appliedFiles.map((entry) => entry.filePath);
  for (const appliedFile of applicationReport.appliedFiles) {
    const absolutePath = path.join(targetRepoPath, appliedFile.filePath);
    const exists = fs.existsSync(absolutePath);
    gateResults.push({
      gateId: `applied_file_exists:${appliedFile.filePath}`,
      status: exists ? "passed" : "failed",
      message: exists
        ? `Applied file exists: ${appliedFile.filePath}`
        : `Applied file is missing: ${appliedFile.filePath}`,
    });

    if (exists && appliedFile.afterHash) {
      const actualHash = hashRepoFile(targetRepoPath, appliedFile.filePath);
      gateResults.push({
        gateId: `applied_file_hash_matches:${appliedFile.filePath}`,
        status: actualHash === appliedFile.afterHash ? "passed" : "failed",
        message:
          actualHash === appliedFile.afterHash
            ? `Applied file hash matches report for ${appliedFile.filePath}.`
            : `Applied file hash mismatch for ${appliedFile.filePath}.`,
        details: {
          expectedHash: appliedFile.afterHash,
          actualHash,
        },
      });
    }
  }

  let currentBranch: string | null = null;
  try {
    currentBranch = readCurrentBranchFromRepo(targetRepoPath);
    gateResults.push({
      gateId: "worktree_branch_readable",
      status: "passed",
      message: `Current worktree branch is ${currentBranch}.`,
      details: { currentBranch },
    });
  } catch (error) {
    gateResults.push({
      gateId: "worktree_branch_readable",
      status: "failed",
      message:
        error instanceof Error
          ? `Could not read worktree branch: ${error.message}`
          : "Could not read worktree branch.",
    });
  }

  if (branchName?.trim()) {
    gateResults.push({
      gateId: "worktree_branch_matches_run",
      status: currentBranch === branchName ? "passed" : "failed",
      message:
        currentBranch === branchName
          ? "Worktree branch matches run.branchName."
          : `Worktree branch must match run.branchName (${branchName}).`,
      details: { currentBranch, expectedBranch: branchName },
    });
  }

  gateResults.push({
    gateId: "no_additional_patch_application",
    status: "passed",
    message: "Deterministic validation did not apply additional patches.",
  });

  const overallStatus = summarizeOverallStatus(gateResults);
  const passedCount = gateResults.filter((gate) => gate.status === "passed").length;
  const gateSummary = `${overallStatus}:${passedCount}/${gateResults.length}`;

  return {
    gateResults,
    overallStatus,
    changedFiles: appliedFiles,
    appliedFiles,
    worktreeGitStatusSummary: [
      "deterministic_validation_only",
      `branch=${currentBranch ?? "unknown"}`,
      `applied_files=${appliedFiles.length}`,
      `changed_files=${appliedFiles.length}`,
    ].join("; "),
    gateSummary,
  };
}
