import { getEngineerConsoleDb } from "../../db/client";
import { assertRepoVerifiedForIndexing } from "../file-index/file-index-manager";
import { countIndexedFiles } from "../file-index/list-indexed-files";
import { CodeIndexError } from "./code-index-types";
import type { CodeChunkRecord, CodeIndexRunRecord, SymbolRecord } from "./code-index-types";
import { indexRepoCode } from "./index-repo-code";
import {
  countCodeChunks,
  countSymbols,
  searchCodeChunks,
  searchSymbols,
  type SearchCodeChunksOptions,
  type SearchSymbolsOptions,
} from "./search-symbols";

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

export function assertFileIndexExists(repoId: string): void {
  if (countIndexedFiles(repoId) === 0) {
    throw new CodeIndexError(
      "File metadata index is required before code indexing. Run file index first.",
    );
  }
}

export function runCodeIndexForRepo(repoId: string): CodeIndexRunRecord {
  const repo = assertRepoVerifiedForIndexing(repoId);
  assertFileIndexExists(repoId);
  return indexRepoCode(repoId, repo.path, repo.name);
}

export function listCodeIndexRuns(repoId: string, limit = 10): CodeIndexRunRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_code_index_runs WHERE repo_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(repoId, limit) as CodeIndexRunRow[];
  return rows.map(mapRun);
}

export function toPublicSymbol(symbol: SymbolRecord) {
  return {
    id: symbol.id,
    relativePath: symbol.relativePath,
    name: symbol.name,
    kind: symbol.kind,
    language: symbol.language,
    lineStart: symbol.lineStart,
    lineEnd: symbol.lineEnd,
    signature: symbol.signature,
    exported: symbol.exported,
    indexedAt: symbol.indexedAt,
  };
}

export function toPublicCodeChunk(chunk: CodeChunkRecord) {
  return {
    id: chunk.id,
    relativePath: chunk.relativePath,
    language: chunk.language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    contentHashPrefix: chunk.contentHash.slice(0, 12),
    contentPreview: chunk.contentPreview,
    tokenEstimate: chunk.tokenEstimate,
    indexedAt: chunk.indexedAt,
  };
}

export function toPublicCodeIndexRun(run: CodeIndexRunRecord) {
  return {
    id: run.id,
    repoId: run.repoId,
    status: run.status,
    fileCount: run.fileCount,
    symbolCount: run.symbolCount,
    chunkCount: run.chunkCount,
    skippedCount: run.skippedCount,
    errorCount: run.errorCount,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage,
  };
}

function tokenizeSearchTerms(terms: string[]): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    for (const piece of term.toLowerCase().split(/[^a-z0-9_]+/)) {
      if (piece.length >= 3) out.add(piece);
    }
  }
  return [...out];
}

/** Bounded symbol/chunk summary for model prompt context. */
export function buildCodeIndexContextSummary(
  repoId: string,
  searchTerms: string[] = [],
  limits: { maxSymbols?: number; maxChunks?: number; maxPreviewChars?: number } = {},
): string | null {
  const symbolTotal = countSymbols(repoId);
  const chunkTotal = countCodeChunks(repoId);
  if (symbolTotal === 0 && chunkTotal === 0) return null;

  const maxSymbols = limits.maxSymbols ?? 25;
  const maxChunks = limits.maxChunks ?? 8;
  const maxPreviewChars = limits.maxPreviewChars ?? 600;

  const tokens = tokenizeSearchTerms(searchTerms);
  let symbols: SymbolRecord[] = [];
  if (symbolTotal > 0) {
    if (tokens.length > 0) {
      for (const token of tokens.slice(0, 5)) {
        symbols.push(...searchSymbols({ repoId, q: token, limit: maxSymbols }));
      }
    } else {
      symbols = searchSymbols({ repoId, limit: maxSymbols });
    }
    const seen = new Set<string>();
    symbols = symbols.filter((s) => {
      const key = `${s.relativePath}:${s.name}:${s.lineStart}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maxSymbols);
  }

  let chunks: CodeChunkRecord[] = [];
  if (chunkTotal > 0) {
    if (tokens.length > 0) {
      for (const token of tokens.slice(0, 3)) {
        chunks.push(...searchCodeChunks({ repoId, q: token, limit: maxChunks }));
      }
    } else {
      chunks = searchCodeChunks({ repoId, limit: maxChunks });
    }
    const seen = new Set<string>();
    chunks = chunks.filter((c) => {
      const key = `${c.relativePath}:${c.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maxChunks);
  }

  const symbolLines =
    symbols.length > 0
      ? symbols
          .map(
            (s) =>
              `- ${s.relativePath}:${s.lineStart} ${s.kind} ${s.name}${s.exported ? " (exported)" : ""}`,
          )
          .join("\n")
      : "";

  const chunkLines =
    chunks.length > 0
      ? chunks
          .map((c) => {
            const preview =
              c.contentPreview.length > maxPreviewChars
                ? `${c.contentPreview.slice(0, maxPreviewChars)}…`
                : c.contentPreview;
            return `- ${c.relativePath}:${c.startLine}-${c.endLine}\n${preview}`;
          })
          .join("\n\n")
      : "";

  return [
    `Code index: ${symbolTotal} symbols, ${chunkTotal} chunks`,
    symbolLines ? `Relevant symbols:\n${symbolLines}` : "",
    chunkLines ? `Relevant chunk previews:\n${chunkLines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export {
  searchSymbols,
  searchCodeChunks,
  countSymbols,
  countCodeChunks,
  CodeIndexError,
};
export type { SearchSymbolsOptions, SearchCodeChunksOptions, SymbolRecord, CodeChunkRecord };
