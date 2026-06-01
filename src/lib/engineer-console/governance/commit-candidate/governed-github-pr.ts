import { runGh } from "../../release/pr-creation/controlled-git-executor";
import { PrCreationError } from "../../release/pr-creation/pr-creation-types";

export const GOVERNED_GITHUB_PR_USES_SHELL = false as const;

export interface GovernedGithubPrResult {
  prUrl: string;
  prNumber: string | null;
  createdNewPr: boolean;
}

function assertValidGithubPrUrl(value: string): string {
  if (!value.trim() || value.includes("\0")) {
    throw new PrCreationError("Invalid GitHub PR URL.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return value;
  } catch {
    throw new PrCreationError("Invalid GitHub PR URL.");
  }
}

function parsePrNumber(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match?.[1] ?? null;
}

export function isGovernedGithubPrClientEnabled(): boolean {
  return process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE !== "true";
}

export async function findGovernedGithubPr(
  repoPath: string,
  headBranch: string,
  baseBranch: string,
): Promise<GovernedGithubPrResult | null> {
  const { stdout } = await runGh(
    [
      "pr",
      "list",
      "--head",
      headBranch,
      "--base",
      baseBranch,
      "--state",
      "all",
      "--json",
      "number,url",
    ],
    repoPath,
  );

  if (!stdout) return null;

  let parsed: Array<{ number?: number; url?: string }> = [];
  try {
    parsed = JSON.parse(stdout) as Array<{ number?: number; url?: string }>;
  } catch {
    throw new PrCreationError(`Unexpected gh pr list output: ${stdout.slice(0, 200)}`);
  }

  const existing = parsed.find(
    (entry) => typeof entry.url === "string" && entry.url.startsWith("http"),
  );
  if (!existing?.url) return null;

  return {
    prUrl: assertValidGithubPrUrl(existing.url),
    prNumber: existing.number ? String(existing.number) : parsePrNumber(existing.url),
    createdNewPr: false,
  };
}

export async function createGovernedGithubPr(input: {
  repoPath: string;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
}): Promise<GovernedGithubPrResult> {
  if (!isGovernedGithubPrClientEnabled()) {
    throw new PrCreationError("GitHub PR creation is disabled by configuration.");
  }

  const existing = await findGovernedGithubPr(
    input.repoPath,
    input.headBranch,
    input.baseBranch,
  );
  if (existing) return existing;

  const ghArgs = [
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    input.body,
    "--base",
    input.baseBranch,
    "--head",
    input.headBranch,
  ];

  const { stdout } = await runGh(ghArgs, input.repoPath);
  const prUrlLine = stdout.split("\n").find((line) => line.startsWith("http")) ?? stdout;
  if (!prUrlLine.startsWith("http")) {
    throw new PrCreationError(`Unexpected gh pr create output: ${stdout.slice(0, 200)}`);
  }

  const prUrl = assertValidGithubPrUrl(prUrlLine);
  return {
    prUrl,
    prNumber: parsePrNumber(prUrl),
    createdNewPr: true,
  };
}
