import type { DetectedApiSurface, ScanContentSlice } from "./compatibility-types";
import { hashDetectionSnippet, lineNumberAtIndex } from "./compatibility-utils";

const CLIENT_PATTERNS: Array<{
  pattern: RegExp;
  confidence: "low" | "medium" | "high";
  methodGroup: number;
  pathGroup: number;
}> = [
  {
    pattern: /fetch\(\s*['"`]([^'"`]+)['"`]/gi,
    confidence: "high",
    methodGroup: 0,
    pathGroup: 1,
  },
  {
    pattern: /axios\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi,
    confidence: "high",
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    pattern: /(?:http|this\.http)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi,
    confidence: "medium",
    methodGroup: 1,
    pathGroup: 2,
  },
];

export function detectHttpClientCallsInContent(slice: ScanContentSlice): DetectedApiSurface[] {
  const surfaces: DetectedApiSurface[] = [];
  const seen = new Set<string>();

  for (const { pattern, confidence, methodGroup, pathGroup } of CLIENT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(slice.content)) !== null) {
      const method = methodGroup > 0 ? (match[methodGroup] ?? "GET").toUpperCase() : "GET";
      const routePath = match[pathGroup];
      if (!routePath || routePath.length < 2) continue;

      const line = lineNumberAtIndex(slice.content, match.index, slice.startLine);
      const key = `${slice.repoId}:${method}:${routePath}:${slice.relativePath}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      surfaces.push({
        repoId: slice.repoId,
        relativePath: slice.relativePath,
        surfaceType: "http_client",
        method,
        routePath,
        name: routePath,
        language: slice.language,
        lineStart: line,
        lineEnd: line,
        sourceHash: hashDetectionSnippet(`${slice.relativePath}:${method}:${routePath}`),
        confidence,
      });
    }
  }

  return surfaces;
}

export function detectHttpClientCallsFromSlices(slices: ScanContentSlice[]): DetectedApiSurface[] {
  return slices.flatMap((slice) => detectHttpClientCallsInContent(slice));
}
