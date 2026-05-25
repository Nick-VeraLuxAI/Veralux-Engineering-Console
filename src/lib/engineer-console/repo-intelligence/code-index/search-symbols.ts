import { getEngineerConsoleDb } from "../../db/client";
import type { CodeChunkRecord, SymbolRecord } from "./code-index-types";

interface SymbolRow {
  id: string;
  repo_id: string;
  file_id: string;
  relative_path: string;
  name: string;
  kind: string;
  language: string | null;
  line_start: number;
  line_end: number;
  signature: string;
  exported: number;
  indexed_at: string;
}

interface ChunkRow {
  id: string;
  repo_id: string;
  file_id: string;
  relative_path: string;
  language: string | null;
  start_line: number;
  end_line: number;
  content_hash: string;
  content_preview: string;
  token_estimate: number;
  indexed_at: string;
}

function mapSymbol(row: SymbolRow): SymbolRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    fileId: row.file_id,
    relativePath: row.relative_path,
    name: row.name,
    kind: row.kind,
    language: row.language,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    signature: row.signature,
    exported: row.exported === 1,
    indexedAt: row.indexed_at,
  };
}

function mapChunk(row: ChunkRow): CodeChunkRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    fileId: row.file_id,
    relativePath: row.relative_path,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    contentHash: row.content_hash,
    contentPreview: row.content_preview,
    tokenEstimate: row.token_estimate,
    indexedAt: row.indexed_at,
  };
}

export interface SearchSymbolsOptions {
  repoId: string;
  q?: string;
  kind?: string;
  limit?: number;
}

export function searchSymbols(options: SearchSymbolsOptions): SymbolRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const params: Record<string, unknown> = { repo_id: options.repoId, limit };
  let sql = `SELECT * FROM engineer_symbols WHERE repo_id = @repo_id`;

  if (options.kind) {
    sql += ` AND kind = @kind`;
    params.kind = options.kind;
  }

  if (options.q?.trim()) {
    sql += ` AND (name LIKE @q OR relative_path LIKE @q OR signature LIKE @q)`;
    params.q = `%${options.q.trim().replace(/%/g, "")}%`;
  }

  sql += ` ORDER BY relative_path ASC, line_start ASC LIMIT @limit`;
  const rows = getEngineerConsoleDb().prepare(sql).all(params) as SymbolRow[];
  return rows.map(mapSymbol);
}

export interface SearchCodeChunksOptions {
  repoId: string;
  q?: string;
  language?: string;
  limit?: number;
}

export function searchCodeChunks(options: SearchCodeChunksOptions): CodeChunkRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const params: Record<string, unknown> = { repo_id: options.repoId, limit };
  let sql = `SELECT * FROM engineer_code_chunks WHERE repo_id = @repo_id`;

  if (options.language) {
    sql += ` AND language = @language`;
    params.language = options.language;
  }

  if (options.q?.trim()) {
    sql += ` AND (relative_path LIKE @q OR content_preview LIKE @q)`;
    params.q = `%${options.q.trim().replace(/%/g, "")}%`;
  }

  sql += ` ORDER BY relative_path ASC, start_line ASC LIMIT @limit`;
  const rows = getEngineerConsoleDb().prepare(sql).all(params) as ChunkRow[];
  return rows.map(mapChunk);
}

export function countSymbols(repoId: string): number {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT COUNT(*) AS count FROM engineer_symbols WHERE repo_id = ?`)
    .get(repoId) as { count: number };
  return row.count;
}

export function countCodeChunks(repoId: string): number {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT COUNT(*) AS count FROM engineer_code_chunks WHERE repo_id = ?`)
    .get(repoId) as { count: number };
  return row.count;
}
