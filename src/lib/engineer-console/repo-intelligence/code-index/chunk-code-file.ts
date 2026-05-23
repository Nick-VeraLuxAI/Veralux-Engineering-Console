import { createHash } from "crypto";
import type { CodeChunkSlice } from "./code-index-types";

export const DEFAULT_CHUNK_LINE_SIZE = 60;
export const DEFAULT_CHUNK_OVERLAP = 10;
export const DEFAULT_MAX_CHUNK_PREVIEW_CHARS = 1500;

function truncatePreview(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}…[truncated]`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkCodeFileContent(
  content: string,
  options: {
    chunkLineSize?: number;
    overlap?: number;
    maxPreviewChars?: number;
  } = {},
): CodeChunkSlice[] {
  const chunkLineSize = options.chunkLineSize ?? DEFAULT_CHUNK_LINE_SIZE;
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP;
  const maxPreviewChars = options.maxPreviewChars ?? DEFAULT_MAX_CHUNK_PREVIEW_CHARS;
  const lines = content.split("\n");
  const chunks: CodeChunkSlice[] = [];
  const step = Math.max(1, chunkLineSize - overlap);

  for (let i = 0; i < lines.length; i += step) {
    const start = i;
    const end = Math.min(i + chunkLineSize, lines.length);
    const chunkLines = lines.slice(start, end);
    const chunkContent = chunkLines.join("\n");

    if (chunkContent.trim().length === 0) {
      if (end >= lines.length) break;
      continue;
    }

    const contentHash = createHash("sha256").update(chunkContent, "utf8").digest("hex");
    const contentPreview = truncatePreview(chunkContent, maxPreviewChars);

    chunks.push({
      startLine: start + 1,
      endLine: end,
      content: chunkContent,
      contentHash,
      contentPreview,
      tokenEstimate: estimateTokens(contentPreview),
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

export function hashChunkContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
