import { getEngineerConsoleDb } from "../../db/client";
import type { IndexedFileRecord } from "./file-index-types";

interface IndexedFileRow {
  id: string;
  repo_id: string;
  relative_path: string;
  file_name: string;
  extension: string | null;
  language: string | null;
  size_bytes: number;
  content_hash: string;
  is_binary: number;
  is_generated: number;
  indexed_at: string;
}

function mapRow(row: IndexedFileRow): IndexedFileRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    relativePath: row.relative_path,
    fileName: row.file_name,
    extension: row.extension,
    language: row.language,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    isBinary: row.is_binary === 1,
    isGenerated: row.is_generated === 1,
    indexedAt: row.indexed_at,
  };
}

export interface ListIndexedFilesOptions {
  repoId: string;
  q?: string;
  language?: string;
  limit?: number;
}

export function listIndexedFiles(options: ListIndexedFilesOptions): IndexedFileRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const params: Record<string, unknown> = { repo_id: options.repoId, limit };
  let sql = `SELECT * FROM engineer_indexed_files WHERE repo_id = @repo_id`;

  if (options.language) {
    sql += ` AND language = @language`;
    params.language = options.language;
  }

  if (options.q?.trim()) {
    sql += ` AND relative_path LIKE @q`;
    params.q = `%${options.q.trim().replace(/%/g, "")}%`;
  }

  sql += ` ORDER BY relative_path ASC LIMIT @limit`;

  const rows = getEngineerConsoleDb().prepare(sql).all(params) as IndexedFileRow[];
  return rows.map(mapRow);
}

export function getIndexedFilePathSet(repoId: string): Set<string> {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT relative_path FROM engineer_indexed_files WHERE repo_id = ?`)
    .all(repoId) as Array<{ relative_path: string }>;
  return new Set(rows.map((r) => r.relative_path));
}

export function countIndexedFiles(repoId: string): number {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT COUNT(*) AS count FROM engineer_indexed_files WHERE repo_id = ?`)
    .get(repoId) as { count: number };
  return row.count;
}
