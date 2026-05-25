import { buildPrBody } from "./build-pr-body";
import {
  getCurrentBranch,
  getHeadCommitSha,
  getRefCommitSha,
  runGh,
  runGit,
} from "./controlled-git-executor";
import { PrCreationError } from "./pr-creation-types";

export interface CreateGithubPrInput {
  repoPath: string;
  runId: string;
  branchName: string;
  baseBranch: string;
  title: string;
  draft: boolean;
  rationale?: string | null;
}

export interface CreateGithubPrResult {
  prUrl: string;
  prNumber: string | null;
  pushStatus: "pushed" | "skipped_existing_remote";
  createdNewPr: boolean;
}

function parsePrNumber(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match?.[1] ?? null;
}

function getRemoteBranchRef(branchName: string): string {
  return `refs/remotes/origin/${branchName}`;
}

async function findExistingPr(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<CreateGithubPrResult | null> {
  const { stdout } = await runGh(
    [
      "pr",
      "list",
      "--head",
      branchName,
      "--base",
      baseBranch,
      "--state",
      "all",
      "--json",
      "number,url",
    ],
    repoPath,
  );

  if (!stdout) {
    return null;
  }

  let parsed: Array<{ number?: number; url?: string }> = [];
  try {
    parsed = JSON.parse(stdout) as Array<{ number?: number; url?: string }>;
  } catch {
    throw new PrCreationError(`Unexpected gh pr list output: ${stdout.slice(0, 200)}`);
  }

  const existing = parsed.find((entry) => typeof entry.url === "string" && entry.url.startsWith("http"));
  if (!existing?.url) {
    return null;
  }

  return {
    prUrl: existing.url,
    prNumber: existing.number ? String(existing.number) : parsePrNumber(existing.url),
    pushStatus: "skipped_existing_remote",
    createdNewPr: false,
  };
}

export async function createControlledGithubPr(
  input: CreateGithubPrInput,
): Promise<CreateGithubPrResult> {
  const currentBranch = await getCurrentBranch(input.repoPath);
  if (currentBranch !== input.branchName) {
    await runGit(["checkout", input.branchName], input.repoPath);
  }

  const localSha = await getHeadCommitSha(input.repoPath);
  const remoteSha = await getRefCommitSha(input.repoPath, getRemoteBranchRef(input.branchName));
  const pushStatus =
    remoteSha && remoteSha === localSha ? "skipped_existing_remote" : "pushed";

  if (pushStatus === "pushed") {
    await runGit(["push", "-u", "origin", input.branchName], input.repoPath);
  }

  const existingPr = await findExistingPr(input.repoPath, input.branchName, input.baseBranch);
  if (existingPr) {
    return { ...existingPr, pushStatus };
  }

  const body = buildPrBody({ runId: input.runId, rationale: input.rationale });
  const ghArgs = [
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    body,
    "--base",
    input.baseBranch,
    "--head",
    input.branchName,
  ];
  if (input.draft) {
    ghArgs.push("--draft");
  }

  const { stdout } = await runGh(ghArgs, input.repoPath);
  const prUrl = stdout.split("\n").find((line) => line.startsWith("http")) ?? stdout;
  if (!prUrl.startsWith("http")) {
    throw new PrCreationError(`Unexpected gh pr create output: ${stdout.slice(0, 200)}`);
  }

  return {
    prUrl,
    prNumber: parsePrNumber(prUrl),
    pushStatus,
    createdNewPr: true,
  };
}
