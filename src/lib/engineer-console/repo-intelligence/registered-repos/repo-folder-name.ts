const RESERVED_NAME = /^(a|an|the|new|git|called|named|for|please|local|repo|repository)$/i;
const FORBIDDEN_BASENAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".env",
  "secrets",
]);

export function sanitizeRepoFolderName(raw: string): string | null {
  const name = raw.trim().replace(/[/\\]+/g, "");
  if (!/^[A-Za-z][A-Za-z0-9._-]{1,62}$/.test(name)) return null;
  if (RESERVED_NAME.test(name) || FORBIDDEN_BASENAMES.has(name) || name === "." || name === "..") {
    return null;
  }
  return name;
}
