import { sanitizeRepoFolderName } from "../repo-intelligence/registered-repos/repo-folder-name";

export { sanitizeRepoFolderName };

export const START_REPO_HREF = "/engineer?focus=repository&start=repo";

export type StartRepoProposal = {
  type: "start_repo";
  name: string | null;
  description: string | null;
};

const START_INTENT =
  /\b((start|create|make|initialize|init|spin\s+up)\s+(a\s+|the\s+)?(new\s+)?(local\s+)?(git\s+)?repo(sitory)?\b|register\s+(a\s+|the\s+)?(new\s+)?repo(sitory)?\b|new\s+(git\s+)?repo(sitory)?\b)/i;

const NEGATED_START_REPO =
  /\b(?:do\s+not|don't|never|must\s+not|cannot|can't|should\s+not|will\s+not)\b[^.;\n]{0,48}\b(?:create|start|make|initialize|init|spin\s+up|register)\b[^.;\n]{0,48}\b(?:repo|repository)\b/i;

const REJECTED_REPO_NAMES = new Set([
  "elsewhere",
  "random",
  "another",
  "different",
  "new",
  "here",
  "there",
  "instead",
]);

export function looksLikeAlignmentAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const numbered = trimmed.split(/\n+/).filter((line) => /^\s*\d+\.\s+\S/.test(line)).length;
  if (numbered >= 2) return true;
  if (numbered >= 1 && trimmed.length > 180) return true;
  return false;
}

export function parseStartRepoIntent(text: string): StartRepoProposal | null {
  const trimmed = text.trim();
  if (!START_INTENT.test(trimmed)) return null;
  if (NEGATED_START_REPO.test(trimmed)) return null;
  if (/\bno\s+new\s+repo\b/i.test(trimmed)) return null;
  if (/\bnot\s+(?:a\s+)?(?:random\s+)?new\s+repo\b/i.test(trimmed)) return null;
  if (/\brepo\s+elsewhere\b/i.test(trimmed)) return null;
  if (looksLikeAlignmentAnswer(trimmed)) return null;

  const named =
    trimmed.match(/\b(?:called|named)\s+["'`]?([A-Za-z][\w.-]{1,62})["'`]?/i) ??
    trimmed.match(/\bnew\s+(?:git\s+)?repo(?:sitory)?\s+["'`]?([A-Za-z][\w.-]{1,62})["'`]?/i);

  const candidate = named?.[1] ?? null;
  if (candidate && REJECTED_REPO_NAMES.has(candidate.toLowerCase())) return null;
  const name = candidate ? sanitizeRepoFolderName(candidate) : null;

  const purpose = trimmed.match(/\b(?:for|about)\s+["'`]?(.{3,120}?)["'`]?\s*$/i);
  let description = purpose?.[1]?.trim() ?? null;
  if (description && name && description.toLowerCase() === name.toLowerCase()) {
    description = null;
  }
  if (description && /^(me|us|it|this|that|please)$/i.test(description)) {
    description = null;
  }

  return { type: "start_repo", name, description };
}

export function shouldHonorStartRepoIntent(text: string, workingRepoId: string | null): boolean {
  const proposal = parseStartRepoIntent(text);
  if (!proposal) return false;
  if (!workingRepoId) return true;

  const trimmed = text.trim();
  if (trimmed.length > 280) return false;
  return /^\s*(start|create|make|initialize|init|spin\s+up|register)\b/i.test(trimmed);
}

export function startRepoReply(proposal: StartRepoProposal): string {
  if (proposal.name) {
    return `I can start a local git repo named ${proposal.name}. Confirm below and I will create it under your approved root, then map it. This does not start a run.`;
  }
  return "I can start a new local git repo. Enter a name below (and optional purpose), then confirm. This does not start a run.";
}

export function publicStartRepoError(message: string): string {
  if (/allowlist|approved repo roots/i.test(message)) {
    return "The new repo must be created inside an approved repo root.";
  }
  return message
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s"'`]+/g, "that folder")
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "…")
    .slice(0, 200);
}
