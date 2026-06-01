import { getLatestWorkerPlanForRun } from "../../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";
import { getChangedFiles } from "../../workspace/git-workspace";
import { normalizeRelativePath } from "../../worker-plan/path-safety";
import { HERMES_GLOBAL_FORBIDDEN_PATHS, normalizeHermesPath } from "../../hermes-worker/hermes-policy";
import { CommitCandidateError } from "./validate-commit-candidate-for-run";

function pathIsForbidden(relativePath: string): boolean {
  const file = normalizeHermesPath(relativePath);
  for (const forbidden of HERMES_GLOBAL_FORBIDDEN_PATHS) {
    const f = normalizeHermesPath(forbidden);
    if (file === f || file.startsWith(`${f}/`)) return true;
  }
  return false;
}

export async function assertWorkingTreeMatchesCandidate(input: {
  runId: string;
  repoPath: string;
  candidateChangedFiles: string[];
}): Promise<string[]> {
  const workerPlanRecord = getLatestWorkerPlanForRun(input.runId);
  if (!workerPlanRecord || workerPlanRecord.validationStatus !== "valid") {
    throw new CommitCandidateError("Valid worker plan is required", "WORKER_PLAN_INVALID");
  }
  const plan = JSON.parse(workerPlanRecord.planJson) as WorkerPlan;
  const allowedSet = new Set(plan.allowedFiles.map((p) => normalizeRelativePath(p)));
  const candidateSet = new Set(
    input.candidateChangedFiles.map((p) => normalizeRelativePath(p)).sort(),
  );

  const treeFiles = await getChangedFiles(input.repoPath, { workerPlanPaths: plan.allowedFiles });

  for (const file of treeFiles) {
    const normalized = normalizeRelativePath(file);
    if (pathIsForbidden(normalized)) {
      throw new CommitCandidateError(`Forbidden path modified: ${file}`, "FORBIDDEN_PATH");
    }
    if (!allowedSet.has(normalized)) {
      throw new CommitCandidateError(`File out of worker plan scope: ${file}`, "FILE_OUT_OF_SCOPE");
    }
    if (!candidateSet.has(normalized)) {
      throw new CommitCandidateError(`Unrelated working tree file: ${file}`, "UNRELATED_FILE");
    }
  }

  for (const file of candidateSet) {
    if (!treeFiles.map((f) => normalizeRelativePath(f)).includes(file)) {
      throw new CommitCandidateError(
        `Candidate file missing from working tree: ${file}`,
        "CANDIDATE_FILE_MISSING",
      );
    }
  }

  return [...candidateSet].sort();
}
