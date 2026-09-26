import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GithubAccessStatus = {
  connected: boolean;
  login: string | null;
  source: "gh" | "none";
  message: string;
};

export type GithubRemoteRepo = {
  name: string;
  nameWithOwner: string;
  description: string;
  url: string;
  isPrivate: boolean;
  updatedAt: string | null;
  language: string | null;
};

export class GithubAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAccessError";
  }
}

type GhRunner = (args: string[]) => Promise<string>;

const LIST_JSON_FIELDS = "name,nameWithOwner,description,url,isPrivate,updatedAt,primaryLanguage";

function defaultGhRunner(args: string[], timeoutMs: number): Promise<string> {
  return execFileAsync("gh", args, {
    timeout: timeoutMs,
    maxBuffer: 8_000_000,
    env: process.env,
  }).then((result) => result.stdout);
}

export function assertAllowedGhArgs(args: string[]): void {
  const [command, sub] = args;
  if (command === "api" && args[1] === "user" && args.length <= 4) return;
  if (command === "repo" && sub === "list") return;
  if (command === "search" && sub === "repos") return;
  if (command === "repo" && sub === "clone" && args.length >= 4) return;
  throw new GithubAccessError(`GitHub command not allowed: gh ${args.join(" ")}`);
}

export async function runGh(
  args: string[],
  options: { timeoutMs?: number; runner?: GhRunner } = {},
): Promise<string> {
  assertAllowedGhArgs(args);
  const runner = options.runner ?? ((next) => defaultGhRunner(next, options.timeoutMs ?? 20_000));
  try {
    return await runner(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GithubAccessError(message.replace(/\s+/g, " ").slice(0, 280));
  }
}

export async function getGithubAccessStatus(
  runner: GhRunner = (args) => defaultGhRunner(args, 12_000),
): Promise<GithubAccessStatus> {
  try {
    const raw = await runGh(["api", "user"], { runner, timeoutMs: 12_000 });
    const payload = JSON.parse(raw) as { login?: string };
    const login = typeof payload.login === "string" ? payload.login : null;
    if (!login) {
      return { connected: false, login: null, source: "none", message: "GitHub did not return an account." };
    }
    return {
      connected: true,
      login,
      source: "gh",
      message: `Connected as ${login}`,
    };
  } catch {
    return {
      connected: false,
      login: null,
      source: "none",
      message: "GitHub is not connected. Run gh auth login on this machine.",
    };
  }
}

function mapRemoteRepo(item: Record<string, unknown>): GithubRemoteRepo | null {
  const nameWithOwner = typeof item.nameWithOwner === "string" ? item.nameWithOwner : "";
  const name = typeof item.name === "string" ? item.name : nameWithOwner.split("/")[1] ?? "";
  const url = typeof item.url === "string" ? item.url : "";
  if (!nameWithOwner || !url) return null;
  const language =
    item.primaryLanguage && typeof item.primaryLanguage === "object"
      ? String((item.primaryLanguage as { name?: string }).name ?? "") || null
      : null;
  return {
    name,
    nameWithOwner,
    description: typeof item.description === "string" ? item.description : "",
    url,
    isPrivate: item.isPrivate === true,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    language,
  };
}

export async function listGithubRepos(
  query = "",
  runner: GhRunner = (args) => defaultGhRunner(args, 20_000),
): Promise<GithubRemoteRepo[]> {
  const q = query.trim();
  const args = q
    ? ["search", "repos", q, "--limit", "20", "--json", LIST_JSON_FIELDS]
    : ["repo", "list", "--limit", "40", "--json", LIST_JSON_FIELDS];
  const raw = await runGh(args, { runner, timeoutMs: 20_000 });
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const mapped = mapRemoteRepo(item as Record<string, unknown>);
    return mapped ? [mapped] : [];
  });
}
