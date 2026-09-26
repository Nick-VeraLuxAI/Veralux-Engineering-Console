/** Paths managed by the worktree runtime — not AE-authored mutations. */
export function isWorktreeInfrastructurePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return false;
  if (normalized === "node_modules" || normalized.startsWith("node_modules/")) return true;
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  return false;
}
