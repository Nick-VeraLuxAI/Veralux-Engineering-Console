import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { GithubPrViewSnapshot, MergeMethod } from "./merge-control-types";
import { MergeControlError } from "./merge-control-types";

const execFileAsync = promisify(execFile);

export interface GhCommandResult {
  stdout: string;
  stderr: string;
}

export interface ControlledGhMergeExecutor {
  gh(args: string[], repoPath: string): Promise<GhCommandResult>;
}

const PR_VIEW_JSON_FIELDS = "state,merged,mergeCommit,url,headRefName,baseRefName,headRefOid";

function hasForbiddenShellChars(args: string[]): boolean {
  return args.some((a) => /[;|&`]/.test(a));
}

function assertGhMergeArgsAllowed(args: string[]): void {
  if (hasForbiddenShellChars(args)) {
    throw new MergeControlError("Invalid characters in gh arguments.");
  }

  if (args[0] !== "pr" || args.length < 3) {
    throw new MergeControlError(`gh command not allowed: gh ${args.join(" ")}`);
  }

  if (args[1] === "view") {
    if (args.length !== 5 || args[3] !== "--json" || args[4] !== PR_VIEW_JSON_FIELDS) {
      throw new MergeControlError(`gh pr view shape not allowed: gh ${args.join(" ")}`);
    }
    return;
  }

  if (args[1] === "merge") {
    const methodFlags = args.filter(
      (a) => a === "--squash" || a === "--merge" || a === "--rebase",
    );
    if (methodFlags.length !== 1) {
      throw new MergeControlError(
        "gh pr merge requires exactly one of --squash, --merge, or --rebase.",
      );
    }
    if (args.some((a) => a === "--auto")) {
      throw new MergeControlError("gh pr merge must not use --auto.");
    }
    const deleteBranchFlags = args.filter((a) => a.startsWith("--delete-branch"));
    if (deleteBranchFlags.length !== 1 || deleteBranchFlags[0] !== "--delete-branch=false") {
      throw new MergeControlError("gh pr merge must use --delete-branch=false.");
    }
    if (args.length !== 5) {
      throw new MergeControlError(`gh pr merge shape not allowed: gh ${args.join(" ")}`);
    }
    return;
  }

  throw new MergeControlError(`gh command not allowed: gh ${args.join(" ")}`);
}

async function defaultGhExec(args: string[], repoPath: string): Promise<GhCommandResult> {
  assertGhMergeArgsAllowed(args);
  const resolved = path.resolve(repoPath);
  const { stdout, stderr } = await execFileAsync("gh", args, {
    cwd: resolved,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

let executorOverride: ControlledGhMergeExecutor | null = null;

export function setControlledGhMergeExecutorForTests(executor: ControlledGhMergeExecutor | null): void {
  executorOverride = executor;
}

export function getControlledGhMergeExecutor(): ControlledGhMergeExecutor {
  if (executorOverride) return executorOverride;
  return { gh: defaultGhExec };
}

export async function runGhMerge(args: string[], repoPath: string): Promise<GhCommandResult> {
  return getControlledGhMergeExecutor().gh(args, repoPath);
}

function resolvePrRef(prNumber: string | null, prUrl: string | null): string {
  if (prNumber?.trim()) return prNumber.trim();
  if (prUrl?.trim()) return prUrl.trim();
  throw new MergeControlError("PR number or URL is required for gh commands.");
}

export async function viewGithubPr(
  repoPath: string,
  prNumber: string | null,
  prUrl: string | null,
): Promise<GithubPrViewSnapshot> {
  const ref = resolvePrRef(prNumber, prUrl);
  const { stdout } = await runGhMerge(
    ["pr", "view", ref, "--json", PR_VIEW_JSON_FIELDS],
    repoPath,
  );

  let parsed: {
    state?: string;
    merged?: boolean;
    url?: string;
    headRefName?: string;
    baseRefName?: string;
    headRefOid?: string;
    mergeCommit?: { oid?: string } | null;
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new MergeControlError("Unable to parse gh pr view response.");
  }

  return {
    state: parsed.state ?? "UNKNOWN",
    merged: parsed.merged === true,
    url: parsed.url ?? prUrl ?? "",
    headRefName: parsed.headRefName ?? "",
    baseRefName: parsed.baseRefName ?? "",
    headRefOid: parsed.headRefOid ?? null,
    mergeCommitOid: parsed.mergeCommit?.oid ?? null,
  };
}

export async function mergeGithubPr(
  repoPath: string,
  prNumber: string | null,
  prUrl: string | null,
  mergeMethod: MergeMethod | "rebase" = "squash",
): Promise<GhCommandResult> {
  const ref = resolvePrRef(prNumber, prUrl);
  const methodFlag =
    mergeMethod === "merge" ? "--merge" : mergeMethod === "rebase" ? "--rebase" : "--squash";
  return runGhMerge(["pr", "merge", ref, methodFlag, "--delete-branch=false"], repoPath);
}
