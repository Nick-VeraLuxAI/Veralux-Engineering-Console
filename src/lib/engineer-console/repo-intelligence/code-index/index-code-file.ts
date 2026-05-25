import fs from "fs";
import { resolvePathWithinRepo } from "../../worker-plan/path-safety";
import { isProtectedWorkerPath } from "../../worker-plan/path-safety";
import { getMaxIndexFileBytes, shouldSkipFilePath } from "../file-index/file-index-policy";
import { bufferLooksBinary } from "../file-index/file-index-policy";
import type { IndexedFileRecord } from "../file-index/file-index-types";
import { chunkCodeFileContent } from "./chunk-code-file";
import { CODE_INDEX_LANGUAGES } from "./code-index-types";
import { extractSymbolsFromContent } from "./symbol-extractor";

export interface IndexCodeFileResult {
  symbols: ReturnType<typeof extractSymbolsFromContent>;
  chunks: ReturnType<typeof chunkCodeFileContent>;
  skipped: boolean;
  skipReason?: string;
}

export function indexCodeFile(
  repoRoot: string,
  file: IndexedFileRecord,
): IndexCodeFileResult {
  if (file.isBinary) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "binary" };
  }

  const skipCheck = shouldSkipFilePath(file.relativePath);
  if (skipCheck.skip) {
    return { symbols: [], chunks: [], skipped: true, skipReason: skipCheck.reason };
  }

  if (isProtectedWorkerPath(file.relativePath, {})) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "protected_path" };
  }

  const language = file.language ?? "plaintext";
  if (!CODE_INDEX_LANGUAGES.has(language)) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "unsupported_language" };
  }

  const resolved = resolvePathWithinRepo(repoRoot, file.relativePath);
  if (!resolved.ok) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "path_escape" };
  }

  if (file.sizeBytes > getMaxIndexFileBytes()) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "oversized" };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(resolved.resolved.absolutePath);
  } catch (error) {
    return {
      symbols: [],
      chunks: [],
      skipped: true,
      skipReason: error instanceof Error ? error.message : "read_error",
    };
  }

  if (bufferLooksBinary(buffer)) {
    return { symbols: [], chunks: [], skipped: true, skipReason: "binary" };
  }

  const content = buffer.toString("utf8");
  const symbols = extractSymbolsFromContent(content, language);
  const chunks = chunkCodeFileContent(content);

  return { symbols, chunks, skipped: false };
}
