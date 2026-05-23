import { getEngineerConsoleDb } from "../../db/client";
import { getTestProfileForRepo } from "../test-detection/detect-test-profile";
import { listPackageScriptsForRepo } from "../package-scripts/detect-package-scripts";
import type {
  RegisteredRepo,
  RegisteredRepoSummary,
  VerificationStatus,
} from "./registered-repo-types";

export interface RegisteredRepoRow {
  id: string;
  name: string;
  path: string;
  description: string;
  language: string;
  verification_status: string;
  verification_message: string;
  verified_at: string | null;
  file_count: number;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapRegisteredRepoRow(row: RegisteredRepoRow): RegisteredRepo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    language: row.language,
    verificationStatus: row.verification_status as VerificationStatus,
    verificationMessage: row.verification_message,
    verifiedAt: row.verified_at,
    fileCount: row.file_count,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRegisteredRepoById(id: string): RegisteredRepo | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_registered_repos WHERE id = ?`)
    .get(id) as RegisteredRepoRow | undefined;
  return row ? mapRegisteredRepoRow(row) : null;
}

export function getRegisteredRepoByPath(repoPath: string): RegisteredRepo | null {
  const resolved = repoPath;
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_registered_repos WHERE path = ?`)
    .get(resolved) as RegisteredRepoRow | undefined;
  return row ? mapRegisteredRepoRow(row) : null;
}

export function getRegisteredRepoSummary(id: string): RegisteredRepoSummary | null {
  const repo = getRegisteredRepoById(id);
  if (!repo) return null;
  return {
    ...repo,
    packageScripts: listPackageScriptsForRepo(id),
    testProfile: getTestProfileForRepo(id),
  };
}
