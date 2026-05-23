import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { RepoPathPolicyError } from "./registered-repo-types";

const FORBIDDEN_BASENAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".env",
  "secrets",
]);

export function getRepoRootAllowlist(): string[] | null {
  const raw = process.env.ENGINEER_CONSOLE_REPO_ROOTS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((entry) => path.resolve(entry.trim()))
    .filter((entry) => entry.length > 0);
}

export function isRepoRootAllowlistConfigured(): boolean {
  return getRepoRootAllowlist() !== null;
}

export function hashRepoPathForAudit(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  const base = path.basename(resolved);
  const digest = createHash("sha256").update(resolved, "utf8").digest("hex").slice(0, 12);
  return `${base}:${digest}`;
}

export function validateRegistrationPath(inputPath: string): string {
  const resolved = path.resolve(inputPath.trim());

  if (!resolved) {
    throw new RepoPathPolicyError("Path must not be empty");
  }

  if (!fs.existsSync(resolved)) {
    throw new RepoPathPolicyError(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new RepoPathPolicyError(`Path is not a directory: ${resolved}`);
  }

  const base = path.basename(resolved);
  if (FORBIDDEN_BASENAMES.has(base)) {
    throw new RepoPathPolicyError(`Cannot register protected directory name: ${base}`);
  }

  for (const segment of resolved.split(path.sep)) {
    if (FORBIDDEN_BASENAMES.has(segment)) {
      throw new RepoPathPolicyError(`Path contains forbidden segment: ${segment}`);
    }
  }

  const allowlist = getRepoRootAllowlist();
  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (!allowed) {
      throw new RepoPathPolicyError("Path is outside ENGINEER_CONSOLE_REPO_ROOTS allowlist");
    }
  }

  return resolved;
}
