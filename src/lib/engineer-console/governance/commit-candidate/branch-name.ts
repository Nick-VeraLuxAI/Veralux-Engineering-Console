const BRANCH_NAME_PATTERN = /^engineering\/run-[a-f0-9]{8}-[a-z0-9][a-z0-9-]{0,39}$/;

export function slugifyTaskTitleForBranch(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

export function recommendCommitCandidateBranchName(runId: string, taskTitle: string): string {
  const shortRun = runId.replace(/-/g, "").slice(0, 8);
  const slug = slugifyTaskTitleForBranch(taskTitle);
  return `engineering/run-${shortRun}-${slug}`;
}

export function validateCommitCandidateBranchName(branchName: string): void {
  if (!BRANCH_NAME_PATTERN.test(branchName)) {
    throw new Error("Branch name does not match engineering/run-{id}-{slug} policy");
  }
}
