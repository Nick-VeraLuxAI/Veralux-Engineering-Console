import { assessChangedFiles } from "../../governance/governance-engine";
import { getChangedFiles } from "../../workspace/git-workspace";
import { buildCommitMessage } from "./build-commit-message";
import { getHeadCommitSha, runGit } from "./controlled-git-executor";
import { PrCreationError } from "./pr-creation-types";

const EXTRA_BLOCKED_PATTERNS = [
  /^\.env$/,
  /^\.env\./,
  /^node_modules(\/|$)/,
  /^\.git(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
];

function isExtraBlocked(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return EXTRA_BLOCKED_PATTERNS.some((p) => p.test(normalized));
}

function filterCommittableFiles(files: string[]): string[] {
  const governance = assessChangedFiles(files);
  if (governance.riskLevel === "blocked" || governance.blockedFiles.length > 0) {
    throw new PrCreationError(
      `Protected files cannot be committed: ${governance.blockedFiles.slice(0, 5).join(", ")}`,
    );
  }
  const safe = files.filter((f) => !isExtraBlocked(f));
  if (safe.length === 0) {
    throw new PrCreationError("No committable files after protected-path filtering.");
  }
  return safe;
}

export interface CreateGitCommitResult {
  commitSha: string;
  commitMessage: string;
  filesCommitted: string[];
}

export async function createControlledGitCommit(
  repoPath: string,
  runId: string,
): Promise<CreateGitCommitResult> {
  const changedFiles = await getChangedFiles(repoPath);
  if (changedFiles.length === 0) {
    throw new PrCreationError("No changes to commit.");
  }

  const filesToCommit = filterCommittableFiles(changedFiles);
  const commitMessage = buildCommitMessage(runId);

  await runGit(["add", ...filesToCommit], repoPath);
  await runGit(["commit", "-m", commitMessage], repoPath);
  const commitSha = await getHeadCommitSha(repoPath);

  return { commitSha, commitMessage, filesCommitted: filesToCommit };
}
