import { getEngineerConsoleDb } from "../../db/client";
import { getRegisteredRepoById } from "../registered-repos/get-repo";
import { indexRepoFiles } from "./index-repo-files";
import {
  countIndexedFiles,
  listIndexedFiles,
  type ListIndexedFilesOptions,
} from "./list-indexed-files";
import type { FileIndexRunRecord, IndexedFileRecord } from "./file-index-types";
import { FileIndexError } from "./file-index-types";

interface IndexRunRow {
  id: string;
  repo_id: string;
  status: string;
  scanned_count: number;
  indexed_count: number;
  skipped_count: number;
  error_count: number;
  skipped_summary_json: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function mapIndexRun(row: IndexRunRow): FileIndexRunRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    status: row.status as FileIndexRunRecord["status"],
    scannedCount: row.scanned_count,
    indexedCount: row.indexed_count,
    skippedCount: row.skipped_count,
    errorCount: row.error_count,
    skippedSummaryJson: row.skipped_summary_json,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function assertRepoVerifiedForIndexing(repoId: string) {
  const repo = getRegisteredRepoById(repoId);
  if (!repo) {
    throw new FileIndexError(`Registered repo not found: ${repoId}`);
  }
  if (repo.verificationStatus !== "ok") {
    throw new FileIndexError(
      `Repository must be verified (status ok) before indexing. Current: ${repo.verificationStatus}`,
    );
  }
  return repo;
}

export function runFileIndexForRepo(repoId: string): FileIndexRunRecord {
  const repo = assertRepoVerifiedForIndexing(repoId);
  return indexRepoFiles(repoId, repo.path, repo.name);
}

export function listFileIndexRuns(repoId: string, limit = 20): FileIndexRunRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_file_index_runs
       WHERE repo_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(repoId, limit) as IndexRunRow[];
  return rows.map(mapIndexRun);
}

export function toPublicIndexedFile(file: IndexedFileRecord) {
  return {
    id: file.id,
    relativePath: file.relativePath,
    fileName: file.fileName,
    extension: file.extension,
    language: file.language,
    sizeBytes: file.sizeBytes,
    contentHashPrefix: file.contentHash.slice(0, 12),
    isBinary: file.isBinary,
    isGenerated: file.isGenerated,
    indexedAt: file.indexedAt,
  };
}

export function toPublicFileIndexRun(run: FileIndexRunRecord) {
  let skippedSummary: Record<string, number> = {};
  try {
    skippedSummary = JSON.parse(run.skippedSummaryJson) as Record<string, number>;
  } catch {
    skippedSummary = {};
  }
  return {
    id: run.id,
    repoId: run.repoId,
    status: run.status,
    scannedCount: run.scannedCount,
    indexedCount: run.indexedCount,
    skippedCount: run.skippedCount,
    errorCount: run.errorCount,
    skippedSummary,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage,
  };
}

export function buildIndexedFileInventorySummary(repoId: string, maxPaths = 80): string | null {
  const total = countIndexedFiles(repoId);
  if (total === 0) return null;

  const files = listIndexedFiles({ repoId, limit: maxPaths });
  const byLanguage: Record<string, number> = {};
  for (const file of files) {
    const lang = file.language ?? "unknown";
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }

  const langSummary = Object.entries(byLanguage)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `${lang}:${count}`)
    .join(", ");

  const pathSample = files
    .slice(0, 40)
    .map((f) => `${f.relativePath} (${f.language ?? "?"})`)
    .join("\n");

  const truncatedNote =
    total > files.length ? `\n… and ${total - files.length} more indexed files` : "";

  return [
    `Indexed file inventory: ${total} files`,
    `Languages: ${langSummary}`,
    `Sample paths (relative):`,
    pathSample,
    truncatedNote,
  ]
    .filter(Boolean)
    .join("\n");
}

export { listIndexedFiles, countIndexedFiles, getIndexedFilePathSet } from "./list-indexed-files";
export { FileIndexError } from "./file-index-types";

export type { ListIndexedFilesOptions, IndexedFileRecord, FileIndexRunRecord };
