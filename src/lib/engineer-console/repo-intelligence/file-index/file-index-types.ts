export const FILE_INDEX_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type FileIndexRunStatus = (typeof FILE_INDEX_RUN_STATUSES)[number];

export const SKIP_REASONS = [
  "skipped_directory",
  "protected_path",
  "oversized",
  "binary",
  "path_escape",
  "read_error",
  "symlink",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export interface FileIndexSkippedEntry {
  relativePath: string;
  reason: SkipReason;
  detail?: string;
}

export interface ScannedFileCandidate {
  relativePath: string;
  fileName: string;
  extension: string | null;
  absolutePath: string;
  sizeBytes: number;
}

export interface IndexedFileRecord {
  id: string;
  repoId: string;
  relativePath: string;
  fileName: string;
  extension: string | null;
  language: string | null;
  sizeBytes: number;
  contentHash: string;
  isBinary: boolean;
  isGenerated: boolean;
  indexedAt: string;
}

export interface FileIndexRunRecord {
  id: string;
  repoId: string;
  status: FileIndexRunStatus;
  scannedCount: number;
  indexedCount: number;
  skippedCount: number;
  errorCount: number;
  skippedSummaryJson: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface FileIndexResult {
  indexRun: FileIndexRunRecord;
  indexedCount: number;
  skippedCount: number;
  skippedSummary: Record<string, number>;
}

export class FileIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileIndexError";
  }
}
