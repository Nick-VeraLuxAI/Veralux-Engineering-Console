import fs from "fs";
import path from "path";
import {
  buildRepoControlPlane,
  emptyRepoControlPlane,
  type RepoControlFacts,
  type RepoControlPlane,
} from "../../dashboard/repo-control-plane";
import { buildRepoVisualMap, type RepoVisualMap } from "../../dashboard/repo-visual-map";
import { resolveGithubOwnerRepo } from "../../governance/commit-candidate/parse-github-origin";

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export type MappedCodebase = {
  id: string;
  name: string;
  path: string;
  language: string;
  fileCount: number;
  folders: string[];
  github: { owner: string; repo: string } | null;
  visual: RepoVisualMap;
  control: RepoControlPlane;
};

export function listCodebaseFolders(repoPath: string, limit = 8): string[] {
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) return [];
  try {
    return fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function buildMappedCodebase(input: {
  id: string;
  name: string;
  path: string;
  language: string;
  fileCount: number;
  indexedPaths?: string[];
  controlFacts?: RepoControlFacts;
}): MappedCodebase {
  const folders = listCodebaseFolders(input.path);
  const visual = buildRepoVisualMap({
    id: input.id,
    name: input.name,
    language: input.language,
    fileCount: input.fileCount,
    folders,
    indexedPaths: input.indexedPaths,
  });
  return {
    id: input.id,
    name: input.name,
    path: input.path,
    language: input.language,
    fileCount: input.fileCount,
    folders,
    github: resolveGithubOwnerRepo(input.path),
    visual,
    control: input.controlFacts
      ? buildRepoControlPlane({ repoId: input.id, visual, facts: input.controlFacts })
      : emptyRepoControlPlane(),
  };
}
