import fs from "fs";
import path from "path";

export function parseGithubOwnerRepoFromOriginUrl(originUrl: string): {
  owner: string;
  repo: string;
} | null {
  const trimmed = originUrl.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]!.replace(/\.git$/, "") };
  }
  try {
    const url = new URL(trimmed);
    if (!url.hostname.endsWith("github.com")) return null;
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export function readOriginUrlFromRepo(repoPath: string): string | null {
  const configPath = path.join(path.resolve(repoPath), ".git", "config");
  if (!fs.existsSync(configPath)) return null;
  const config = fs.readFileSync(configPath, "utf8");
  const sectionMatch = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/);
  if (!sectionMatch) return null;
  const urlMatch = sectionMatch[0].match(/^\s*url\s*=\s*(.+)$/m);
  return urlMatch?.[1]?.trim() ?? null;
}

export function resolveGithubOwnerRepo(repoPath: string): { owner: string; repo: string } | null {
  const originUrl = readOriginUrlFromRepo(repoPath);
  if (!originUrl) return null;
  return parseGithubOwnerRepoFromOriginUrl(originUrl);
}
