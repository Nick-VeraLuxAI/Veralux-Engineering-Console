export const CODE_INDEX_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type CodeIndexRunStatus = (typeof CODE_INDEX_RUN_STATUSES)[number];

export interface ExtractedSymbol {
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  exported: boolean;
}

export interface CodeChunkSlice {
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  contentPreview: string;
  tokenEstimate: number;
}

export interface SymbolRecord {
  id: string;
  repoId: string;
  fileId: string;
  relativePath: string;
  name: string;
  kind: string;
  language: string | null;
  lineStart: number;
  lineEnd: number;
  signature: string;
  exported: boolean;
  indexedAt: string;
}

export interface CodeChunkRecord {
  id: string;
  repoId: string;
  fileId: string;
  relativePath: string;
  language: string | null;
  startLine: number;
  endLine: number;
  contentHash: string;
  contentPreview: string;
  tokenEstimate: number;
  indexedAt: string;
}

export interface CodeIndexRunRecord {
  id: string;
  repoId: string;
  status: CodeIndexRunStatus;
  fileCount: number;
  symbolCount: number;
  chunkCount: number;
  skippedCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CodeIndexResult {
  indexRun: CodeIndexRunRecord;
  symbolCount: number;
  chunkCount: number;
}

export class CodeIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeIndexError";
  }
}

/** Languages eligible for symbol/chunk extraction in Phase 5C. */
export const CODE_INDEX_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "python",
  "markdown",
  "plaintext",
]);
