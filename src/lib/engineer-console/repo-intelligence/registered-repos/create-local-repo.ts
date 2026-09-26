import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { sanitizeRepoFolderName } from "./repo-folder-name";
import { registerRepo } from "./register-repo";
import {
  getEffectiveRegistrationRoots,
  getGithubCloneRoot,
  getRepoRootAllowlist,
} from "./repo-path-policy";
import { RepoPathPolicyError, type RegisteredRepoSummary } from "./registered-repo-types";

const execFileAsync = promisify(execFile);

export function resolveCreateRepoRoot(): string {
  const allowlist = getRepoRootAllowlist();
  if (allowlist?.[0]) return path.resolve(allowlist[0]);
  const roots = getEffectiveRegistrationRoots();
  if (roots?.[0]) return path.resolve(roots[0]);
  const clone = getGithubCloneRoot();
  if (clone) return path.resolve(clone);
  throw new RepoPathPolicyError("No approved repo root is configured. Set approved roots before starting a repo.");
}

export function validateCreateDestination(name: string): string {
  const folder = sanitizeRepoFolderName(name);
  if (!folder) {
    throw new RepoPathPolicyError(
      "Name must start with a letter and use letters, numbers, dots, hyphens, or underscores.",
    );
  }

  const root = resolveCreateRepoRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new RepoPathPolicyError("Approved repo root is missing.");
  }

  const dest = path.resolve(root, folder);
  if (dest === root || !dest.startsWith(`${root}${path.sep}`)) {
    throw new RepoPathPolicyError("The new repo must be created inside an approved repo root.");
  }

  const allowlist = getEffectiveRegistrationRoots();
  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some((entry) => {
      const resolved = path.resolve(entry);
      return dest === resolved || dest.startsWith(`${resolved}${path.sep}`);
    });
    if (!allowed) {
      throw new RepoPathPolicyError("The new repo must be created inside an approved repo root.");
    }
  }

  return dest;
}

function publicReadme(name: string, description?: string): string {
  const title = name.replace(/[^\w.\- ]/g, "").slice(0, 80);
  const body = (description?.trim() || "New local repository started from the Engineering Console.")
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s]+/g, "")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)[^\s]*/gi, "")
    .replace(/\b[A-Z][A-Z0-9_]{3,}=[^\s]+/g, "[redacted]")
    .trim()
    .slice(0, 400);
  return `# ${title}\n\n${body}\n`;
}

async function initGitRepo(dest: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: dest, timeout: 20_000 });
}

export async function createLocalRegisteredRepo(input: {
  name: string;
  description?: string;
}): Promise<RegisteredRepoSummary> {
  const dest = validateCreateDestination(input.name);
  const folder = path.basename(dest);
  const existed = fs.existsSync(dest);
  if (existed) {
    if (!fs.statSync(dest).isDirectory()) {
      throw new RepoPathPolicyError("A file with that name already exists.");
    }
    const isGit = fs.existsSync(path.join(dest, ".git"));
    const entries = fs.readdirSync(dest).filter((entry) => entry !== "." && entry !== "..");
    if (isGit) {
      return registerRepo({
        path: dest,
        name: folder,
        description: input.description?.trim() || undefined,
      });
    }
    if (entries.length > 0) {
      throw new RepoPathPolicyError("A folder with that name already exists and is not a git repo.");
    }
  } else {
    fs.mkdirSync(dest);
  }

  try {
    await initGitRepo(dest);
  } catch {
    if (!existed) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    throw new RepoPathPolicyError("Could not create the git repository.");
  }

  const readmePath = path.join(dest, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, publicReadme(folder, input.description), "utf8");
  }

  return registerRepo({
    path: dest,
    name: folder,
    description: input.description?.trim() || undefined,
  });
}
