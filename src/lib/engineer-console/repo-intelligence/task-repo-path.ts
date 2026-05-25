import type { EngineeringTask } from "../types";
import { assertRepoUsableForTask } from "./registered-repos/register-repo";
import { RegisteredRepoError } from "./registered-repos/registered-repo-types";

/** Resolve the effective on-disk repo path for a task (registered repo wins over legacy path). */
export function resolveTaskTargetRepoPath(task: EngineeringTask): string {
  if (task.registeredRepoId) {
    const repo = assertRepoUsableForTask(task.registeredRepoId);
    return repo.path;
  }
  return task.targetRepoPath;
}

export function validateTaskRepoInput(input: {
  registeredRepoId?: string;
  targetRepoPath?: string;
}): { targetRepoPath: string; registeredRepoId: string | null } {
  if (input.registeredRepoId?.trim()) {
    const repo = assertRepoUsableForTask(input.registeredRepoId.trim());
    return { targetRepoPath: repo.path, registeredRepoId: repo.id };
  }

  const path = input.targetRepoPath?.trim();
  if (!path) {
    throw new RegisteredRepoError("Either registeredRepoId or targetRepoPath is required");
  }

  return { targetRepoPath: path, registeredRepoId: null };
}
