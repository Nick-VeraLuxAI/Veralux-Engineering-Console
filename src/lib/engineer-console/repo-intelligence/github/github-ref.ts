export type GithubRepoRef = {
  owner: string;
  repo: string;
};

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseGithubRepoRef(input: string): GithubRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const slug = trimmed.replace(/^https?:\/\/github\.com\//i, "").replace(/^git@github\.com:/i, "");
  const cleaned = slug.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) {
    return OWNER_REPO.test(cleaned) ? splitOwnerRepo(cleaned) : null;
  }
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;
  const joined = `${owner}/${repo}`;
  return OWNER_REPO.test(joined) ? { owner, repo: repo.replace(/\.git$/i, "") } : null;
}

function splitOwnerRepo(value: string): GithubRepoRef | null {
  const [owner, repo] = value.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function githubRepoSlug(ref: GithubRepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}
