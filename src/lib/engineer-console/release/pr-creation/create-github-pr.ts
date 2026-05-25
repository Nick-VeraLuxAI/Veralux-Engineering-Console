import { buildPrBody } from "./build-pr-body";
import { getCurrentBranch, runGh, runGit } from "./controlled-git-executor";
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
}

function parsePrNumber(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match?.[1] ?? null;
}

export async function createControlledGithubPr(
  input: CreateGithubPrInput,
): Promise<CreateGithubPrResult> {
  const currentBranch = await getCurrentBranch(input.repoPath);
  if (currentBranch !== input.branchName) {
    await runGit(["checkout", input.branchName], input.repoPath);
  }

  await runGit(["push", "-u", "origin", input.branchName], input.repoPath);

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

  return { prUrl, prNumber: parsePrNumber(prUrl) };
}
