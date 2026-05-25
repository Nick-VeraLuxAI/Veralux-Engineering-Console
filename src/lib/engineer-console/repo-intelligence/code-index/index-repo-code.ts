import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import {
  auditCodeIndexCompleted,
  auditCodeIndexFailed,
  auditCodeIndexStarted,
} from "../../governance/audit-ledger/code-index-audit-lifecycle";
import { listIndexedFiles } from "../file-index/list-indexed-files";
import type { CodeIndexRunRecord } from "./code-index-types";
import { indexCodeFile } from "./index-code-file";

function nowIso(): string {
  return new Date().toISOString();
}

interface CodeIndexRunRow {
  id: string;
  repo_id: string;
  status: string;
  file_count: number;
  symbol_count: number;
  chunk_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function mapRun(row: CodeIndexRunRow): CodeIndexRunRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    status: row.status as CodeIndexRunRecord["status"],
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    chunkCount: row.chunk_count,
    skippedCount: row.skipped_count,
    errorCount: row.error_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function indexRepoCode(repoId: string, repoRoot: string, repoName: string): CodeIndexRunRecord {
  const indexRunId = uuidv4();
  const startedAt = nowIso();
  const db = getEngineerConsoleDb();

  db.prepare(
    `INSERT INTO engineer_code_index_runs
      (id, repo_id, status, file_count, symbol_count, chunk_count, skipped_count, error_count,
       started_at, completed_at, error_message)
     VALUES
      (@id, @repo_id, 'running', 0, 0, 0, 0, 0, @started_at, NULL, NULL)`,
  ).run({ id: indexRunId, repo_id: repoId, started_at: startedAt });

  auditCodeIndexStarted(repoId, { repoName, indexRunId });

  try {
    const files = listIndexedFiles({ repoId, limit: 5000 });
    const indexedAt = nowIso();
    let skippedCount = 0;
    let errorCount = 0;
    let symbolCount = 0;
    let chunkCount = 0;

    const runIndex = db.transaction(() => {
      db.prepare(`DELETE FROM engineer_symbols WHERE repo_id = ?`).run(repoId);
      db.prepare(`DELETE FROM engineer_code_chunks WHERE repo_id = ?`).run(repoId);

      const insertSymbol = db.prepare(
        `INSERT INTO engineer_symbols
          (id, repo_id, file_id, relative_path, name, kind, language, line_start, line_end,
           signature, exported, indexed_at)
         VALUES
          (@id, @repo_id, @file_id, @relative_path, @name, @kind, @language, @line_start, @line_end,
           @signature, @exported, @indexed_at)`,
      );

      const insertChunk = db.prepare(
        `INSERT INTO engineer_code_chunks
          (id, repo_id, file_id, relative_path, language, start_line, end_line,
           content_hash, content_preview, token_estimate, indexed_at)
         VALUES
          (@id, @repo_id, @file_id, @relative_path, @language, @start_line, @end_line,
           @content_hash, @content_preview, @token_estimate, @indexed_at)`,
      );

      for (const file of files) {
        try {
          const result = indexCodeFile(repoRoot, file);
          if (result.skipped) {
            skippedCount++;
            continue;
          }

          for (const sym of result.symbols) {
            insertSymbol.run({
              id: uuidv4(),
              repo_id: repoId,
              file_id: file.id,
              relative_path: file.relativePath,
              name: sym.name,
              kind: sym.kind,
              language: file.language,
              line_start: sym.lineStart,
              line_end: sym.lineEnd,
              signature: sym.signature,
              exported: sym.exported ? 1 : 0,
              indexed_at: indexedAt,
            });
            symbolCount++;
          }

          for (const chunk of result.chunks) {
            insertChunk.run({
              id: uuidv4(),
              repo_id: repoId,
              file_id: file.id,
              relative_path: file.relativePath,
              language: file.language,
              start_line: chunk.startLine,
              end_line: chunk.endLine,
              content_hash: chunk.contentHash,
              content_preview: chunk.contentPreview,
              token_estimate: chunk.tokenEstimate,
              indexed_at: indexedAt,
            });
            chunkCount++;
          }
        } catch {
          errorCount++;
          skippedCount++;
        }
      }

      const completedAt = nowIso();
      db.prepare(
        `UPDATE engineer_code_index_runs SET
          status = 'completed',
          file_count = @file_count,
          symbol_count = @symbol_count,
          chunk_count = @chunk_count,
          skipped_count = @skipped_count,
          error_count = @error_count,
          completed_at = @completed_at
         WHERE id = @id`,
      ).run({
        id: indexRunId,
        file_count: files.length,
        symbol_count: symbolCount,
        chunk_count: chunkCount,
        skipped_count: skippedCount,
        error_count: errorCount,
        completed_at: completedAt,
      });
    });

    runIndex();

    auditCodeIndexCompleted(repoId, {
      repoName,
      indexRunId,
      symbolCount,
      chunkCount,
      skippedCount,
    });

    const row = db
      .prepare(`SELECT * FROM engineer_code_index_runs WHERE id = ?`)
      .get(indexRunId) as CodeIndexRunRow;
    return mapRun(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      `UPDATE engineer_code_index_runs SET status = 'failed', error_message = @error_message, completed_at = @completed_at WHERE id = @id`,
    ).run({ id: indexRunId, error_message: message, completed_at: nowIso() });
    auditCodeIndexFailed(repoId, { repoName, indexRunId, message });
    throw error;
  }
}
