import type { SymbolRecord } from "../code-index/code-index-types";
import type {
  CompatibilityRepoContext,
  DetectedApiSurface,
  DetectedCrossRepoLink,
  ScanContentSlice,
} from "./compatibility-types";
import { hashDetectionSnippet, lineNumberAtIndex, normalizeRoutePath } from "./compatibility-utils";

interface RouteEntry {
  repoId: string;
  repoName: string;
  relativePath: string;
  method: string;
  routePath: string;
  line: number;
}

interface ClientEntry {
  repoId: string;
  repoName: string;
  relativePath: string;
  method: string;
  routePath: string;
  line: number;
}

export function detectExportedSymbolSurfaces(symbols: SymbolRecord[]): DetectedApiSurface[] {
  return symbols
    .filter((s) => s.exported)
    .map((sym) => ({
      repoId: sym.repoId,
      relativePath: sym.relativePath,
      surfaceType: "exported_symbol" as const,
      method: null,
      routePath: null,
      name: sym.name,
      language: sym.language,
      lineStart: sym.lineStart,
      lineEnd: sym.lineEnd,
      sourceHash: hashDetectionSnippet(`${sym.relativePath}:${sym.name}:${sym.signature}`),
      confidence: "high" as const,
    }));
}

export function detectSharedSymbolLinks(
  symbols: SymbolRecord[],
  repos: CompatibilityRepoContext[],
): DetectedCrossRepoLink[] {
  const links: DetectedCrossRepoLink[] = [];
  const repoNameById = new Map(repos.map((r) => [r.repoId, r.repoName]));
  const exported = symbols.filter((s) => s.exported);
  const byName = new Map<string, SymbolRecord[]>();

  for (const sym of exported) {
    const key = sym.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(sym);
  }

  for (const [, group] of byName) {
    const repoIds = new Set(group.map((s) => s.repoId));
    if (repoIds.size < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.repoId === b.repoId) continue;
        const sigMatch = a.signature === b.signature;
        links.push({
          sourceRepoId: a.repoId,
          targetRepoId: b.repoId,
          sourceRelativePath: a.relativePath,
          targetRelativePath: b.relativePath,
          linkType: "shared_symbol",
          status: sigMatch ? "warning" : "breaking",
          confidence: sigMatch ? "medium" : "high",
          summary: sigMatch
            ? `"${a.name}" exported from both ${repoNameById.get(a.repoId) ?? a.repoId} and ${repoNameById.get(b.repoId) ?? b.repoId}`
            : `"${a.name}" exported with different signatures across repos`,
          evidence: {
            symbol: a.name,
            sourceSignature: a.signature.slice(0, 120),
            targetSignature: b.signature.slice(0, 120),
          },
        });
      }
    }
  }

  return links;
}

export function buildRestClientToRouteLinks(
  routes: DetectedApiSurface[],
  clients: DetectedApiSurface[],
  repos: CompatibilityRepoContext[],
): DetectedCrossRepoLink[] {
  const links: DetectedCrossRepoLink[] = [];
  const repoNameById = new Map(repos.map((r) => [r.repoId, r.repoName]));

  const routeEntries: RouteEntry[] = routes
    .filter((r) => r.surfaceType === "rest_route" && r.method && r.routePath)
    .map((r) => ({
      repoId: r.repoId,
      repoName: repoNameById.get(r.repoId) ?? r.repoId,
      relativePath: r.relativePath,
      method: r.method!,
      routePath: r.routePath!,
      line: r.lineStart ?? 1,
    }));

  const clientEntries: ClientEntry[] = clients
    .filter((c) => c.surfaceType === "http_client" && c.routePath)
    .map((c) => ({
      repoId: c.repoId,
      repoName: repoNameById.get(c.repoId) ?? c.repoId,
      relativePath: c.relativePath,
      method: c.method ?? "GET",
      routePath: c.routePath!,
      line: c.lineStart ?? 1,
    }));

  const routeMap = new Map<string, RouteEntry[]>();
  for (const route of routeEntries) {
    const key = `${route.method}:${normalizeRoutePath(route.routePath)}`;
    if (!routeMap.has(key)) routeMap.set(key, []);
    routeMap.get(key)!.push(route);
  }

  for (const client of clientEntries) {
    const key = `${client.method}:${normalizeRoutePath(client.routePath)}`;
    const matches = routeMap.get(key);

    if (matches && matches.length > 0) {
      for (const route of matches) {
        if (route.repoId === client.repoId) continue;
        links.push({
          sourceRepoId: client.repoId,
          targetRepoId: route.repoId,
          sourceRelativePath: client.relativePath,
          targetRelativePath: route.relativePath,
          linkType: "rest_client_to_route",
          status: "compatible",
          confidence: "medium",
          summary: `${client.repoName} calls ${client.method} ${client.routePath} served by ${route.repoName}`,
          evidence: {
            method: client.method,
            path: client.routePath,
            clientLine: client.line,
            routeLine: route.line,
          },
        });
      }
    } else if (repos.length > 1) {
      const fallbackTarget = routeEntries.find((r) => r.repoId !== client.repoId);
      if (fallbackTarget) {
        links.push({
          sourceRepoId: client.repoId,
          targetRepoId: fallbackTarget.repoId,
          sourceRelativePath: client.relativePath,
          targetRelativePath: null,
          linkType: "rest_client_to_route",
          status: "warning",
          confidence: "low",
          summary: `${client.repoName} calls ${client.method} ${client.routePath} — no matching route found`,
          evidence: {
            method: client.method,
            path: client.routePath,
            clientLine: client.line,
          },
        });
      }
    }
  }

  return links;
}

export function detectImportExportLinksFromSlices(
  slices: ScanContentSlice[],
  symbols: SymbolRecord[],
  repos: CompatibilityRepoContext[],
): DetectedCrossRepoLink[] {
  const links: DetectedCrossRepoLink[] = [];
  const repoNameById = new Map(repos.map((r) => [r.repoId, r.repoName]));
  const exportedByName = new Map<string, SymbolRecord[]>();

  for (const sym of symbols.filter((s) => s.exported)) {
    const key = sym.name;
    if (!exportedByName.has(key)) exportedByName.set(key, []);
    exportedByName.get(key)!.push(sym);
  }

  const importPattern = /import\s+\{([^}]+)\}\s+from\s+['"`]([^'"`]+)['"`]/g;

  for (const slice of slices) {
    importPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(slice.content)) !== null) {
      const names = match[1]!
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean);

      for (const importedName of names) {
        if (importedName.length < 2) continue;
        const exports = exportedByName.get(importedName) ?? [];
        for (const exp of exports) {
          if (exp.repoId === slice.repoId) continue;
          const line = lineNumberAtIndex(slice.content, match.index, slice.startLine);
          links.push({
            sourceRepoId: slice.repoId,
            targetRepoId: exp.repoId,
            sourceRelativePath: slice.relativePath,
            targetRelativePath: exp.relativePath,
            linkType: "import_export",
            status: "compatible",
            confidence: "low",
            summary: `${repoNameById.get(slice.repoId) ?? slice.repoId} imports "${importedName}" from ${repoNameById.get(exp.repoId) ?? exp.repoId}`,
            evidence: {
              symbol: importedName,
              sourceLine: line,
              targetLine: exp.lineStart,
            },
          });
        }
      }
    }
  }

  return links;
}
