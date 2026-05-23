import fs from "fs";
import path from "path";
import type { WorkerPlanValidationError } from "./worker-plan-types";

export interface ResolvedRepoPath {
  relativePath: string;
  absolutePath: string;
}

export function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function resolvePathWithinRepo(
  repoRoot: string,
  inputPath: string,
): { ok: true; resolved: ResolvedRepoPath } | { ok: false; error: WorkerPlanValidationError } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "EMPTY_PATH", message: "Path must not be empty", path: inputPath },
    };
  }

  if (path.isAbsolute(trimmed)) {
    return {
      ok: false,
      error: {
        code: "ABSOLUTE_PATH",
        message: "Absolute paths are not allowed",
        path: inputPath,
      },
    };
  }

  const normalized = normalizeRelativePath(trimmed);
  if (normalized.includes("..")) {
    return {
      ok: false,
      error: {
        code: "PATH_TRAVERSAL",
        message: "Path traversal (..) is not allowed",
        path: inputPath,
      },
    };
  }

  const repoResolved = path.resolve(repoRoot);
  const absolutePath = path.resolve(repoResolved, normalized);

  if (absolutePath !== repoResolved && !absolutePath.startsWith(repoResolved + path.sep)) {
    return {
      ok: false,
      error: {
        code: "PATH_ESCAPES_REPO",
        message: "Path escapes repository root after normalization",
        path: inputPath,
      },
    };
  }

  return {
    ok: true,
    resolved: {
      relativePath: normalized,
      absolutePath,
    },
  };
}

export function isProtectedWorkerPath(
  relativePath: string,
  options: { allowPackageLock?: boolean; allowMigrations?: boolean },
): WorkerPlanValidationError | null {
  const file = normalizeRelativePath(relativePath);

  if (file === ".env" || file.startsWith(".env.")) {
    return {
      code: "PROTECTED_PATH",
      message: "Changes to .env files are blocked",
      path: file,
    };
  }
  if (file === ".git" || file.startsWith(".git/")) {
    return {
      code: "PROTECTED_PATH",
      message: "Changes to .git are blocked",
      path: file,
    };
  }
  if (file === "node_modules" || file.startsWith("node_modules/")) {
    return {
      code: "PROTECTED_PATH",
      message: "Changes to node_modules are blocked",
      path: file,
    };
  }
  if (file === "package-lock.json" && !options.allowPackageLock) {
    return {
      code: "PROTECTED_PATH",
      message: "Changes to package-lock.json are blocked unless explicitly allowed",
      path: file,
    };
  }
  if (/^migrations(\/|$)/i.test(file) && !options.allowMigrations) {
    return {
      code: "PROTECTED_PATH",
      message: "Changes to migrations are blocked unless explicitly allowed",
      path: file,
    };
  }

  return null;
}

export function repoRootExists(repoRoot: string): boolean {
  try {
    return fs.statSync(path.resolve(repoRoot)).isDirectory();
  } catch {
    return false;
  }
}
