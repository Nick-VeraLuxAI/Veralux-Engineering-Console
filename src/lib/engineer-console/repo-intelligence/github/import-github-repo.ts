import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { resolveGithubOwnerRepo } from "../../governance/commit-candidate/parse-github-origin";
import { runFileIndexForRepo } from "../file-index/file-index-manager";
import {
  registerRepo,
  toPublicRegisteredRepo,
} from "../registered-repos/register-repo";
import {
  getEffectiveRegistrationRoots,
  getGithubCloneRoot,
  getRepoRootAllowlist,
} from "../registered-repos/repo-path-policy";
import { GithubAccessError, runGh } from "./github-access";
import { buildMappedCodebase, type MappedCodebase } from "./codebase-map";
import { githubRepoSlug, parseGithubRepoRef, type GithubRepoRef } from "./github-ref";

const execFileAsync = promisify(execFile);

export type ImportedGithubRepo = {
  repo: ReturnType<typeof toPublicRegisteredRepo>;
  mapped: MappedCodebase;
  cloned: boolean;
  redirect: string;
};

function isGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, ".git"));
}

function searchRoots(): string[] {
  const roots = [
    ...(getEffectiveRegistrationRoots() ?? []),
    ...(getRepoRootAllowlist() ?? []),
    getGithubCloneRoot(),
  ].filter((root): root is string => Boolean(root));
  return [...new Set(roots)];
}

export function findLocalGithubClone(ref: GithubRepoRef): string | null {
  const names = [ref.repo, `${ref.owner}-${ref.repo}`];
  for (const root of searchRoots()) {
    if (!fs.existsSync(root)) continue;
    if (path.basename(root) === ref.repo && isGitRepo(root)) {
      const origin = resolveGithubOwnerRepo(root);
      if (!origin || (origin.owner === ref.owner && origin.repo === ref.repo)) return root;
    }
    for (const name of names) {
      const candidate = path.join(root, name);
      if (!isGitRepo(candidate)) continue;
      const origin = resolveGithubOwnerRepo(candidate);
      if (!origin || (origin.owner === ref.owner && origin.repo === ref.repo)) {
        return candidate;
      }
    }
  }
  return null;
}

function cloneDestination(ref: GithubRepoRef): string {
  const root = getGithubCloneRoot() ?? getRepoRootAllowlist()?.[0] ?? null;
  if (!root) {
    throw new GithubAccessError(
      "Set ENGINEER_CONSOLE_GITHUB_CLONE_ROOT or ENGINEER_CONSOLE_REPO_ROOTS before cloning a GitHub repo.",
    );
  }
  return path.join(root, ref.repo);
}

export async function cloneGithubRepo(ref: GithubRepoRef): Promise<string> {
  const dest = cloneDestination(ref);
  if (isGitRepo(dest)) return dest;
  if (fs.existsSync(dest)) {
    throw new GithubAccessError(`Clone destination already exists and is not a git repo: ${dest}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await runGh(["repo", "clone", githubRepoSlug(ref), dest], {
    timeoutMs: 180_000,
    runner: async (args) => {
      const result = await execFileAsync("gh", args, {
        timeout: 180_000,
        maxBuffer: 8_000_000,
        env: process.env,
      });
      return result.stdout;
    },
  });
  if (!isGitRepo(dest)) {
    throw new GithubAccessError(`Clone finished without a git repo at ${dest}`);
  }
  return dest;
}

function queueFileIndex(repoId: string): void {
  setImmediate(() => {
    try {
      runFileIndexForRepo(repoId);
    } catch (error) {
      console.error("Auto file index after GitHub import failed:", error);
    }
  });
}

export async function importGithubRepo(input: {
  url?: string;
  owner?: string;
  repo?: string;
}): Promise<ImportedGithubRepo> {
  const ref =
    parseGithubRepoRef(input.url ?? "") ??
    parseGithubRepoRef([input.owner, input.repo].filter(Boolean).join("/"));
  if (!ref) {
    throw new GithubAccessError("Provide a GitHub URL or owner/repo.");
  }

  let cloned = false;
  let repoPath = findLocalGithubClone(ref);
  if (!repoPath) {
    repoPath = await cloneGithubRepo(ref);
    cloned = true;
  }

  const registered = await registerRepo({
    path: repoPath,
    name: ref.repo,
    description: `GitHub ${githubRepoSlug(ref)}`,
  });
  if (registered.verificationStatus === "ok") {
    queueFileIndex(registered.id);
  }

  const mapped = buildMappedCodebase(registered);
  return {
    repo: toPublicRegisteredRepo(registered),
    mapped,
    cloned,
    redirect: `/engineer?focus=repository&repo=${encodeURIComponent(registered.id)}`,
  };
}
