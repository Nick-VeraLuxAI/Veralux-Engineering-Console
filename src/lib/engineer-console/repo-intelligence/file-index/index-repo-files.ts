import { createHash } from "crypto";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import {
  auditFileIndexCompleted,
  auditFileIndexFailed,
  auditFileIndexStarted,
} from "../../governance/audit-ledger/file-index-audit-lifecycle";
import { detectExtension, detectLanguageFromPath } from "./detect-language";
import {
  bufferLooksBinary,
  isLikelyGeneratedPath,
  isLikelyBinaryExtension,
} from "./file-index-policy";
import { scanRepoFiles } from "./scan-repo-files";
import type { FileIndexRunRecord, FileIndexSkippedEntry } from "./file-index-types";

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeSkipped(skipped: FileIndexSkippedEntry[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const entry of skipped) {
    summary[entry.reason] = (summary[entry.reason] ?? 0) + 1;
  }
  return summary;
}

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

function hashFileContent(absolutePath: string): { hash: string; isBinary: boolean } {
  const buffer = fs.readFileSync(absolutePath);
  if (bufferLooksBinary(buffer) || isLikelyBinaryExtension(detectExtension(absolutePath))) {
    return { hash: createHash("sha256").update(buffer).digest("hex"), isBinary: true };
  }
  return { hash: createHash("sha256").update(buffer).digest("hex"), isBinary: false };
}

export function indexRepoFiles(
  repoId: string,
  repoRoot: string,
  repoName: string,
): FileIndexRunRecord {
  const indexRunId = uuidv4();
  const startedAt = nowIso();
  const db = getEngineerConsoleDb();

  db.prepare(
    `INSERT INTO engineer_file_index_runs
      (id, repo_id, status, scanned_count, indexed_count, skipped_count, error_count,
       skipped_summary_json, started_at, completed_at, error_message)
     VALUES
      (@id, @repo_id, 'running', 0, 0, 0, 0, '{}', @started_at, NULL, NULL)`,
  ).run({ id: indexRunId, repo_id: repoId, started_at: startedAt });

  auditFileIndexStarted(repoId, { repoName, indexRunId });

  try {
    const { candidates, skipped, scannedCount } = scanRepoFiles(repoRoot);
    const indexedAt = nowIso();
    let errorCount = 0;
    let indexedCount = 0;
    let skippedSummary: Record<string, number> = {};

    const indexTransaction = db.transaction(() => {
      db.prepare(`DELETE FROM engineer_indexed_files WHERE repo_id = ?`).run(repoId);

      const insert = db.prepare(
        `INSERT INTO engineer_indexed_files
          (id, repo_id, relative_path, file_name, extension, language, size_bytes,
           content_hash, is_binary, is_generated, indexed_at)
         VALUES
          (@id, @repo_id, @relative_path, @file_name, @extension, @language, @size_bytes,
           @content_hash, @is_binary, @is_generated, @indexed_at)`,
      );

      for (const file of candidates) {
        try {
          const { hash, isBinary } = hashFileContent(file.absolutePath);
          if (isBinary) {
            skipped.push({
              relativePath: file.relativePath,
              reason: "binary",
              detail: "detected at read",
            });
            continue;
          }

          insert.run({
            id: uuidv4(),
            repo_id: repoId,
            relative_path: file.relativePath,
            file_name: file.fileName,
            extension: file.extension,
            language: detectLanguageFromPath(file.relativePath),
            size_bytes: file.sizeBytes,
            content_hash: hash,
            is_binary: 0,
            is_generated: isLikelyGeneratedPath(file.relativePath) ? 1 : 0,
            indexed_at: indexedAt,
          });
          indexedCount++;
        } catch (error) {
          errorCount++;
          skipped.push({
            relativePath: file.relativePath,
            reason: "read_error",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      skippedSummary = summarizeSkipped(skipped);
      const completedAt = nowIso();

      db.prepare(
        `UPDATE engineer_file_index_runs SET
          status = 'completed',
          scanned_count = @scanned_count,
          indexed_count = @indexed_count,
          skipped_count = @skipped_count,
          error_count = @error_count,
          skipped_summary_json = @skipped_summary_json,
          completed_at = @completed_at
         WHERE id = @id`,
      ).run({
        id: indexRunId,
        scanned_count: scannedCount,
        indexed_count: indexedCount,
        skipped_count: skipped.length,
        error_count: errorCount,
        skipped_summary_json: JSON.stringify(skippedSummary),
        completed_at: completedAt,
      });

      db.prepare(
        `UPDATE engineer_registered_repos SET
          file_count = @file_count,
          indexed_at = @indexed_at,
          updated_at = @updated_at
         WHERE id = @id`,
      ).run({
        id: repoId,
        file_count: indexedCount,
        indexed_at: completedAt,
        updated_at: completedAt,
      });
    });

    indexTransaction();

    auditFileIndexCompleted(repoId, {
      repoName,
      indexRunId,
      scannedCount,
      indexedCount,
      skippedCount: skipped.length,
      errorCount,
    });

    const row = db
      .prepare(`SELECT * FROM engineer_file_index_runs WHERE id = ?`)
      .get(indexRunId) as IndexRunRow;
    return mapIndexRun(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();
    db.prepare(
      `UPDATE engineer_file_index_runs SET
        status = 'failed',
        error_message = @error_message,
        completed_at = @completed_at
       WHERE id = @id`,
    ).run({ id: indexRunId, error_message: message, completed_at: completedAt });

    auditFileIndexFailed(repoId, { repoName, indexRunId, message });
    throw error;
  }
}
