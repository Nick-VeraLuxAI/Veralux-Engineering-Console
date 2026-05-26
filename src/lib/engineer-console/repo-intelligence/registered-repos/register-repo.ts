import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { detectAndStorePackageScripts } from "../package-scripts/detect-package-scripts";
import { detectAndStoreTestProfile } from "../test-detection/detect-test-profile";
import {
  auditPackageScriptsDetected,
  auditRepoRegistered,
  auditRepoVerificationFailed,
  auditRepoVerified,
  auditTestProfileDetected,
} from "../../governance/audit-ledger/repo-audit-lifecycle";
import type { RegisterRepoInput, RegisteredRepoSummary } from "./registered-repo-types";
import { RegisteredRepoError } from "./registered-repo-types";
import { validateRegistrationPath } from "./repo-path-policy";
import { getRegisteredRepoByPath, getRegisteredRepoSummary } from "./get-repo";
import { inferRepoLanguage, inferRepoName } from "./infer-repo-metadata";
import { verifyRegisteredRepoPath } from "./verify-repo";
import { listCodeIndexRuns } from "../code-index/code-index-manager";

function nowIso(): string {
  return new Date().toISOString();
}

export async function registerRepo(input: RegisterRepoInput): Promise<RegisteredRepoSummary> {
  const resolved = validateRegistrationPath(input.path);
  const existing = getRegisteredRepoByPath(resolved);
  if (existing) {
    return (await refreshRepoDetection(existing.id))!;
  }

  const { description, language } = inferRepoLanguage(resolved);
  const name = inferRepoName(resolved, input.name);
  const id = uuidv4();
  const now = nowIso();

  const db = getEngineerConsoleDb();
  db.prepare(
    `INSERT INTO engineer_registered_repos
      (id, name, path, description, language, verification_status, verification_message,
       verified_at, file_count, indexed_at, created_at, updated_at)
     VALUES
      (@id, @name, @path, @description, @language, 'pending', '', NULL, 0, NULL, @created_at, @updated_at)`,
  ).run({
    id,
    name,
    path: resolved,
    description: input.description ?? description,
    language,
    created_at: now,
    updated_at: now,
  });

  auditRepoRegistered(id, name, resolved);

  const summary = await refreshRepoDetection(id);
  if (!summary) {
    throw new RegisteredRepoError(`Failed to load registered repo after insert: ${id}`);
  }
  return summary;
}

export async function reverifyRegisteredRepo(repoId: string): Promise<RegisteredRepoSummary> {
  const summary = await refreshRepoDetection(repoId);
  if (!summary) {
    throw new RegisteredRepoError(`Registered repo not found: ${repoId}`);
  }
  return summary;
}

export async function refreshRepoDetection(repoId: string): Promise<RegisteredRepoSummary | null> {
  const repo = getRegisteredRepoSummary(repoId);
  if (!repo) return null;

  const verification = await verifyRegisteredRepoPath(repo.path);
  const now = nowIso();

  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_registered_repos SET
        verification_status = @verification_status,
        verification_message = @verification_message,
        verified_at = @verified_at,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: repoId,
      verification_status: verification.verificationStatus,
      verification_message: verification.verificationMessage,
      verified_at: verification.verifiedAt,
      updated_at: now,
    });

  if (verification.verificationStatus === "ok") {
    auditRepoVerified(repoId, repo.name, repo.path);
  } else {
    auditRepoVerificationFailed(repoId, repo.name, repo.path, verification.verificationStatus);
  }

  const scripts = detectAndStorePackageScripts(repoId, repo.path);
  auditPackageScriptsDetected(
    repoId,
    repo.name,
    repo.path,
    scripts.map((s) => s.scriptName),
  );

  const profile = detectAndStoreTestProfile(repoId, repo.path);
  auditTestProfileDetected(repoId, repo.name, repo.path, profile.runner, profile.confidence);

  return getRegisteredRepoSummary(repoId);
}

export function assertRepoUsableForTask(repoId: string): RegisteredRepoSummary {
  const repo = getRegisteredRepoSummary(repoId);
  if (!repo) {
    throw new RegisteredRepoError(`Registered repo not found: ${repoId}`);
  }
  if (repo.verificationStatus === "denied" || repo.verificationStatus === "missing") {
    throw new RegisteredRepoError(
      `Registered repo is not usable (${repo.verificationStatus}): ${repo.verificationMessage}`,
    );
  }
  return repo;
}

export function toPublicRegisteredRepo(summary: RegisteredRepoSummary) {
  const latestCodeIndexRun = listCodeIndexRuns(summary.id, 1)[0] ?? null;
  return {
    id: summary.id,
    name: summary.name,
    path: summary.path,
    description: summary.description,
    language: summary.language,
    verificationStatus: summary.verificationStatus,
    verificationMessage: summary.verificationMessage,
    verifiedAt: summary.verifiedAt,
    fileCount: summary.fileCount,
    indexedAt: summary.indexedAt,
    codeIndex:
      latestCodeIndexRun === null
        ? null
        : {
            status: latestCodeIndexRun.status,
            symbolCount: latestCodeIndexRun.symbolCount,
            chunkCount: latestCodeIndexRun.chunkCount,
            completedAt: latestCodeIndexRun.completedAt,
          },
    packageScripts: summary.packageScripts.map((s) => ({
      scriptName: s.scriptName,
      sourceFile: s.sourceFile,
    })),
    testProfile: summary.testProfile
      ? {
          runner: summary.testProfile.runner,
          confidence: summary.testProfile.confidence,
        }
      : null,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}
