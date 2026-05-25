import { getEngineerConsoleDb } from "../../db/client";
import { searchSymbols } from "../code-index/search-symbols";
import type {
  ApiSurfaceRecord,
  CompatibilityAnalysisRunRecord,
  CompatibilityAnalysisSummary,
  CrossRepoLinkRecord,
  DetectedApiSurface,
  DetectedCrossRepoLink,
  ScanContentSlice,
} from "./compatibility-types";
import {
  buildRestClientToRouteLinks,
  detectExportedSymbolSurfaces,
  detectImportExportLinksFromSlices,
  detectSharedSymbolLinks,
} from "./build-cross-repo-links";
import { detectApiSurfacesFromSlices } from "./detect-api-surfaces";
import { detectHttpClientCallsFromSlices } from "./detect-http-client-calls";
import { detectPackageDependencies } from "./detect-package-dependencies";
import type { CompatibilityRepoContext } from "./compatibility-types";

interface ChunkPreviewRow {
  repo_id: string;
  relative_path: string;
  language: string | null;
  start_line: number;
  end_line: number;
  content_preview: string;
}

export function loadScanSlicesForRepos(repoIds: string[]): ScanContentSlice[] {
  if (repoIds.length === 0) return [];
  const placeholders = repoIds.map(() => "?").join(", ");
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT repo_id, relative_path, language, start_line, end_line, content_preview
       FROM engineer_code_chunks
       WHERE repo_id IN (${placeholders})`,
    )
    .all(...repoIds) as ChunkPreviewRow[];

  return rows.map((row) => ({
    repoId: row.repo_id,
    relativePath: row.relative_path,
    language: row.language,
    content: row.content_preview,
    startLine: row.start_line,
    endLine: row.end_line,
  }));
}

export function loadSymbolsForRepos(repoIds: string[]): ReturnType<typeof searchSymbols> {
  const symbols: ReturnType<typeof searchSymbols> = [];
  for (const repoId of repoIds) {
    symbols.push(...searchSymbols({ repoId, limit: 5000 }));
  }
  return symbols;
}

export function runCompatibilityDetection(
  repos: CompatibilityRepoContext[],
): { surfaces: DetectedApiSurface[]; links: DetectedCrossRepoLink[] } {
  const repoIds = repos.map((r) => r.repoId);
  const slices = loadScanSlicesForRepos(repoIds);
  const symbols = loadSymbolsForRepos(repoIds);

  const packageResult = detectPackageDependencies(repos);
  const routeSurfaces = detectApiSurfacesFromSlices(slices);
  const clientSurfaces = detectHttpClientCallsFromSlices(slices);
  const symbolSurfaces = detectExportedSymbolSurfaces(symbols);

  const restLinks = buildRestClientToRouteLinks(routeSurfaces, clientSurfaces, repos);
  const sharedSymbolLinks = detectSharedSymbolLinks(symbols, repos);
  const importLinks = detectImportExportLinksFromSlices(slices, symbols, repos);

  return {
    surfaces: [...packageResult.surfaces, ...routeSurfaces, ...clientSurfaces, ...symbolSurfaces],
    links: [...packageResult.links, ...restLinks, ...sharedSymbolLinks, ...importLinks],
  };
}

export function countLinkStatuses(links: DetectedCrossRepoLink[]): {
  warningCount: number;
  breakingCount: number;
} {
  return {
    warningCount: links.filter((l) => l.status === "warning" || l.status === "unknown").length,
    breakingCount: links.filter((l) => l.status === "breaking").length,
  };
}

export interface CompatibilitySummaryForRepo {
  repoId: string;
  breakingCount: number;
  warningCount: number;
  unknownCount: number;
  linkCount: number;
  latestRunAt: string | null;
  topLinks: Array<{ status: string; summary: string; linkType: string }>;
}

export function getCompatibilitySummaryForRepo(repoId: string): CompatibilitySummaryForRepo {
  const db = getEngineerConsoleDb();
  const links = db
    .prepare(
      `SELECT status, summary, link_type FROM engineer_cross_repo_links
       WHERE source_repo_id = ? OR target_repo_id = ?
       ORDER BY
         CASE status WHEN 'breaking' THEN 0 WHEN 'warning' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
         detected_at DESC
       LIMIT 50`,
    )
    .all(repoId, repoId) as Array<{ status: string; summary: string; link_type: string }>;

  const latestRun = db
    .prepare(
      `SELECT started_at FROM engineer_compatibility_analysis_runs
       WHERE status = 'completed'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as { started_at: string } | undefined;

  return {
    repoId,
    breakingCount: links.filter((l) => l.status === "breaking").length,
    warningCount: links.filter((l) => l.status === "warning").length,
    unknownCount: links.filter((l) => l.status === "unknown").length,
    linkCount: links.length,
    latestRunAt: latestRun?.started_at ?? null,
    topLinks: links.slice(0, 5).map((l) => ({
      status: l.status,
      summary: l.summary,
      linkType: l.link_type,
    })),
  };
}

export function buildCompatibilityContextSummary(
  repoId: string,
  searchTerms: string[] = [],
): string | null {
  const summary = getCompatibilitySummaryForRepo(repoId);
  if (summary.linkCount === 0) return null;

  const termMatches = searchTerms.length
    ? summary.topLinks.filter((l) =>
        searchTerms.some((t) => l.summary.toLowerCase().includes(t.toLowerCase())),
      )
    : summary.topLinks;

  const lines = [
    `Compatibility (repo ${repoId.slice(0, 8)}…): ${summary.breakingCount} breaking, ${summary.warningCount} warnings, ${summary.unknownCount} unknown`,
  ];

  for (const link of (termMatches.length > 0 ? termMatches : summary.topLinks).slice(0, 5)) {
    lines.push(`- [${link.status}] ${link.linkType}: ${link.summary.slice(0, 200)}`);
  }

  return lines.join("\n");
}

export function toPublicApiSurface(record: ApiSurfaceRecord) {
  return {
    id: record.id,
    repoId: record.repoId,
    relativePath: record.relativePath,
    surfaceType: record.surfaceType,
    method: record.method,
    routePath: record.routePath,
    name: record.name,
    language: record.language,
    lineStart: record.lineStart,
    lineEnd: record.lineEnd,
    confidence: record.confidence,
    detectedAt: record.detectedAt,
  };
}

export function toPublicCrossRepoLink(record: CrossRepoLinkRecord) {
  return {
    id: record.id,
    sourceRepoId: record.sourceRepoId,
    targetRepoId: record.targetRepoId,
    sourceRelativePath: record.sourceRelativePath,
    targetRelativePath: record.targetRelativePath,
    linkType: record.linkType,
    status: record.status,
    confidence: record.confidence,
    summary: record.summary,
    evidence: record.evidence,
    detectedAt: record.detectedAt,
  };
}

export function toPublicAnalysisRun(run: CompatibilityAnalysisRunRecord): CompatibilityAnalysisSummary {
  return {
    run,
    surfaceCount: run.surfaceCount,
    linkCount: run.linkCount,
    warningCount: run.warningCount,
    breakingCount: run.breakingCount,
  };
}
