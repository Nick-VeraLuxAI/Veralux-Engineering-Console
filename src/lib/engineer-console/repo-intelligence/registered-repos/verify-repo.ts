import fs from "fs";
import path from "path";
import { verifyGitRepo } from "../../workspace/git-workspace";
import { validateRegistrationPath } from "./repo-path-policy";
import type { VerificationStatus } from "./registered-repo-types";

export interface RepoVerificationResult {
  verificationStatus: VerificationStatus;
  verificationMessage: string;
  verifiedAt: string | null;
}

export async function verifyRegisteredRepoPath(repoPath: string): Promise<RepoVerificationResult> {
  try {
    validateRegistrationPath(repoPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist")) {
      return { verificationStatus: "missing", verificationMessage: message, verifiedAt: null };
    }
    return { verificationStatus: "denied", verificationMessage: message, verifiedAt: null };
  }

  const resolved = path.resolve(repoPath);
  const gitDir = path.join(resolved, ".git");
  if (!fs.existsSync(gitDir)) {
    try {
      await verifyGitRepo(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Not a git repository";
      return { verificationStatus: "not_git", verificationMessage: message, verifiedAt: null };
    }
  }

  return {
    verificationStatus: "ok",
    verificationMessage: "Repository path verified",
    verifiedAt: new Date().toISOString(),
  };
}
