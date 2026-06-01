import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getTaskById } from "../../task-manager/task-manager";
import {
  auditCommitCandidatePrepared,
  auditCommitCandidateRequested,
  auditCommitCandidateValidated,
} from "../audit-ledger/commit-candidate-audit-lifecycle";
import { insertCommitCandidate } from "./commit-candidate-manager";
import {
  ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA,
  type EngineeringCommitPrCandidatePacketV1,
} from "./commit-candidate-types";
import {
  collectTestEvidencePaths,
  CommitCandidateError,
  validateCommitCandidateForRun,
} from "./validate-commit-candidate-for-run";

export { CommitCandidateError } from "./validate-commit-candidate-for-run";

function buildPullRequestDraftMarkdown(input: {
  title: string;
  runId: string;
  branchName: string;
  commitMessage: string;
  changedFiles: string[];
  signOffDecision: string;
  reviewer: string;
  evidenceSnapshotHash: string;
  qualityGateSummary: unknown;
  rollbackAvailable: boolean;
  testEvidencePaths: string[];
  commitPacketPath: string;
  riskNotes: string[];
}): string {
  const gates = input.qualityGateSummary as {
    status?: string;
    overallStatus?: string;
    passedCount?: number;
    failedCount?: number;
  };
  return [
    `# PR draft (candidate only): ${input.title}`,
    "",
    "> **Not committed / not pushed / not merged / not deployed.**",
    "> Engineering Console prepared this artifact only. No git commit, branch creation, push, or GitHub PR was performed.",
    "",
    "## Summary",
    input.commitMessage,
    "",
    "## Branch recommendation",
    `\`${input.branchName}\` (recommendation only — branch not created)`,
    "",
    "## Changed files",
    ...input.changedFiles.map((f) => `- ${f}`),
    "",
    "## Quality gates",
    `- Status: ${gates.status ?? "—"}`,
    `- Overall: ${gates.overallStatus ?? "—"}`,
    `- Passed: ${gates.passedCount ?? 0} · Failed: ${gates.failedCount ?? 0}`,
    "",
    "## Review sign-off",
    `- Decision: ${input.signOffDecision}`,
    `- Reviewer: ${input.reviewer}`,
    `- Evidence snapshot: \`${input.evidenceSnapshotHash}\``,
    "",
    "## Rollback",
    input.rollbackAvailable
      ? "Rollback artifact is available for this patch application."
      : "No rollback artifact recorded.",
    "",
    "## Test evidence paths",
    ...(input.testEvidencePaths.length
      ? input.testEvidencePaths.map((p) => `- ${p}`)
      : ["- (none)"]),
    "",
    "## Risk notes",
    ...(input.riskNotes.length ? input.riskNotes.map((n) => `- ${n}`) : ["- (none)"]),
    "",
    "## Evidence links",
    `- Commit/PR packet: \`${input.commitPacketPath}\``,
    `- Run: \`/engineer/runs/${input.runId}\``,
    "",
  ].join("\n");
}

export async function prepareCommitCandidateForRun(input: {
  runId: string;
  commitMessage: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  qualityGateOverride?: boolean;
}): Promise<{
  runId: string;
  status: "commit_candidate_prepared";
  branchName: string;
  commitMessage: string;
  changedFiles: string[];
  evidenceSnapshotHash: string;
  commitPacketPath: string;
  prDraftPath: string;
  notCommitted: true;
  notPushed: true;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}> {
  const pendingId = uuidv4();
  let ctx;
  try {
    ctx = await validateCommitCandidateForRun(input);
  } catch (error) {
    if (error instanceof CommitCandidateError) {
      throw error;
    }
    throw new CommitCandidateError(
      error instanceof Error ? error.message : "Validation failed",
      "VALIDATION_FAILED",
    );
  }

  auditCommitCandidateRequested(
    ctx.runId,
    ctx.taskId,
    pendingId,
    { branchName: ctx.branchName, changedFiles: ctx.changedFiles },
    ctx.createdBy,
  );

  auditCommitCandidateValidated(ctx.runId, ctx.taskId, pendingId, {
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    signoffId: ctx.signoff.id,
  });

  const candidateId = uuidv4();
  const artifactDir = path.join(ctx.evidenceDirectory, "commit-candidates", candidateId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const testEvidencePaths = collectTestEvidencePaths(ctx.runId);
  const riskNotes: string[] = [];
  if (input.qualityGateOverride) {
    riskNotes.push("Quality gate override acknowledged at commit candidate preparation.");
  }

  const packet: EngineeringCommitPrCandidatePacketV1 = {
    schema: ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA,
    runId: ctx.runId,
    taskId: ctx.taskId,
    repoPath: ctx.repoPath,
    branchName: ctx.branchName,
    commitMessage: ctx.commitMessage,
    changedFiles: ctx.changedFiles,
    signOffDecision: ctx.signoff.decision,
    signOffId: ctx.signoff.id,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    qualityGateSummary: ctx.qualityGateSummary,
    patchApplicationSummary: ctx.patchApplicationSummary,
    rollbackAvailable: ctx.rollbackAvailable,
    riskNotes,
    testEvidencePaths,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    createdAt: new Date().toISOString(),
    notCommitted: true,
    notPushed: true,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };

  const commitPacketPath = path.join(artifactDir, "commit-pr-packet.json");
  const prDraftPath = path.join(artifactDir, "pull-request-draft.md");

  fs.writeFileSync(commitPacketPath, JSON.stringify(packet, null, 2), "utf8");

  const task = getTaskById(ctx.taskId);
  const prMarkdown = buildPullRequestDraftMarkdown({
    title: task?.title ?? `Run ${ctx.runId}`,
    runId: ctx.runId,
    branchName: ctx.branchName,
    commitMessage: ctx.commitMessage,
    changedFiles: ctx.changedFiles,
    signOffDecision: ctx.signoff.decision,
    reviewer: ctx.signoff.reviewer,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    qualityGateSummary: ctx.qualityGateSummary,
    rollbackAvailable: ctx.rollbackAvailable,
    testEvidencePaths,
    commitPacketPath,
    riskNotes,
  });
  fs.writeFileSync(prDraftPath, prMarkdown, "utf8");

  const record = insertCommitCandidate({
    runId: ctx.runId,
    status: "commit_candidate_prepared",
    branchName: ctx.branchName,
    commitMessage: ctx.commitMessage,
    changedFilesJson: JSON.stringify(ctx.changedFiles),
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    signoffId: ctx.signoff.id,
    commitPacketPath,
    prDraftPath,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
  });

  auditCommitCandidatePrepared(ctx.runId, ctx.taskId, record.id, {
    branchName: ctx.branchName,
    changedFiles: ctx.changedFiles,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    commitPacketPath,
    prDraftPath,
  }, ctx.createdBy);

  return {
    runId: ctx.runId,
    status: "commit_candidate_prepared",
    branchName: ctx.branchName,
    commitMessage: ctx.commitMessage,
    changedFiles: ctx.changedFiles,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    commitPacketPath,
    prDraftPath,
    notCommitted: true,
    notPushed: true,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}
