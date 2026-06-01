const MAX_PR_TITLE_LENGTH = 300;
const MAX_PR_BODY_LENGTH = 50_000;

export class GovernedPrContentError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GovernedPrContentError";
    this.code = code;
  }
}

export function validateGovernedPrTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new GovernedPrContentError("PR title is required", "INVALID_PR_TITLE");
  }
  if (title.startsWith("-")) {
    throw new GovernedPrContentError("PR title must not start with '-'", "INVALID_PR_TITLE");
  }
  if (title.length > MAX_PR_TITLE_LENGTH) {
    throw new GovernedPrContentError("PR title exceeds maximum length", "INVALID_PR_TITLE");
  }
  if (title.includes("\0")) {
    throw new GovernedPrContentError("PR title contains invalid characters", "INVALID_PR_TITLE");
  }
  return title;
}

export function validateGovernedPrBody(value: string): string {
  const body = value.trim();
  if (!body) {
    throw new GovernedPrContentError("PR body is required", "INVALID_PR_BODY");
  }
  if (body.length > MAX_PR_BODY_LENGTH) {
    throw new GovernedPrContentError("PR body exceeds maximum length", "INVALID_PR_BODY");
  }
  if (body.includes("\0")) {
    throw new GovernedPrContentError("PR body contains invalid characters", "INVALID_PR_BODY");
  }
  return body;
}

const BASE_BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export function validateGovernedPrBaseBranch(value: string): string {
  const branch = value.trim();
  if (!branch || !BASE_BRANCH_PATTERN.test(branch)) {
    throw new GovernedPrContentError("Invalid base branch name", "UNSAFE_BASE_BRANCH");
  }
  if (branch.includes("..") || branch.startsWith("-")) {
    throw new GovernedPrContentError("Invalid base branch name", "UNSAFE_BASE_BRANCH");
  }
  return branch;
}
