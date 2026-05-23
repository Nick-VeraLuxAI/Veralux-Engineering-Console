import type { DetectedApiSurface, ScanContentSlice } from "./compatibility-types";
import { hashDetectionSnippet, lineNumberAtIndex } from "./compatibility-utils";

const ROUTE_PATTERNS: Array<{
  pattern: RegExp;
  confidence: "medium" | "high";
  nextHandler?: boolean;
}> = [
  {
    pattern: /(?:router|app)\.(get|post|put|delete|patch|options)\(\s*['"`]([^'"`]+)['"`]/gi,
    confidence: "high",
  },
  {
    pattern: /@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi,
    confidence: "medium",
  },
  {
    pattern: /@(Get|Post|Put|Delete|Patch)\(\s*['"`]([^'"`]*)['"`]?\s*\)/gi,
    confidence: "medium",
  },
  {
    pattern: /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/gi,
    confidence: "medium",
    nextHandler: true,
  },
];

export function detectRestRoutesInContent(slice: ScanContentSlice): DetectedApiSurface[] {
  const surfaces: DetectedApiSurface[] = [];
  const seen = new Set<string>();

  for (const { pattern, confidence, nextHandler } of ROUTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(slice.content)) !== null) {
      const method = match[1]!.toUpperCase();
      const routePath = nextHandler
        ? inferNextRoutePath(slice.relativePath)
        : match[2] ?? "/";
      if (!routePath) continue;

      const line = lineNumberAtIndex(slice.content, match.index, slice.startLine);
      const key = `${slice.repoId}:${method}:${routePath}:${slice.relativePath}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const snippet = `${method} ${routePath}`;
      surfaces.push({
        repoId: slice.repoId,
        relativePath: slice.relativePath,
        surfaceType: "rest_route",
        method,
        routePath,
        name: routePath,
        language: slice.language,
        lineStart: line,
        lineEnd: line,
        sourceHash: hashDetectionSnippet(`${slice.relativePath}:${snippet}`),
        confidence,
      });
    }
  }

  return surfaces;
}

function inferNextRoutePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const routeMatch = normalized.match(/(?:^|\/)app\/api\/(.+)\/route\.(t|j)sx?$/i);
  if (routeMatch) {
    return `/api/${routeMatch[1]!.replace(/\/route\.(t|j)sx?$/i, "")}`;
  }
  if (normalized.includes("/api/")) {
    const idx = normalized.indexOf("/api/");
    return `/${normalized.slice(idx).replace(/\.(t|j)sx?$/, "")}`;
  }
  return relativePath;
}

export function detectApiSurfacesFromSlices(slices: ScanContentSlice[]): DetectedApiSurface[] {
  return slices.flatMap((slice) => detectRestRoutesInContent(slice));
}
