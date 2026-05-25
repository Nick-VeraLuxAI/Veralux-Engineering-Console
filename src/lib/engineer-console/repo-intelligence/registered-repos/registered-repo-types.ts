export const VERIFICATION_STATUSES = [
  "pending",
  "ok",
  "missing",
  "denied",
  "not_git",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface RegisteredRepo {
  id: string;
  name: string;
  path: string;
  description: string;
  language: string;
  verificationStatus: VerificationStatus;
  verificationMessage: string;
  verifiedAt: string | null;
  fileCount: number;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackageScriptRecord {
  id: string;
  repoId: string;
  scriptName: string;
  command: string;
  sourceFile: string;
  detectedAt: string;
}

export interface TestProfileRecord {
  id: string;
  repoId: string;
  runner: string;
  detectCommand: string | null;
  confidence: "high" | "medium" | "low";
  signalsJson: string;
  detectedAt: string;
}

export interface RegisteredRepoSummary extends RegisteredRepo {
  packageScripts: PackageScriptRecord[];
  testProfile: TestProfileRecord | null;
}

export interface RegisterRepoInput {
  path: string;
  name?: string;
  description?: string;
}

export class RepoPathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoPathPolicyError";
  }
}

export class RegisteredRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegisteredRepoError";
  }
}
