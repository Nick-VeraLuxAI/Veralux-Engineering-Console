const UNSAFE_COMMIT_MESSAGE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
const MAX_COMMIT_MESSAGE_LENGTH = 500;

export function validateCommitCandidateMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Commit message is required");
  }
  if (trimmed.length > MAX_COMMIT_MESSAGE_LENGTH) {
    throw new Error("Commit message is too long");
  }
  if (UNSAFE_COMMIT_MESSAGE.test(trimmed)) {
    throw new Error("Commit message contains unsafe control characters");
  }
  if (trimmed.startsWith("-")) {
    throw new Error("Commit message cannot start with '-'");
  }
  const lines = trimmed.split("\n");
  if (lines[0]!.length > 72) {
    throw new Error("Commit message subject line must be 72 characters or fewer");
  }
  return trimmed;
}
