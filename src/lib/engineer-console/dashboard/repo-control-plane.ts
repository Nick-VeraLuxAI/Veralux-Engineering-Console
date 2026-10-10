import type { RepoMapNodeId, RepoVisualMap } from "./repo-visual-map";

export const REPO_CONTRACT_MAX_ITEMS = 8;
export const REPO_CONTRACT_MAX_LINKS = 5;
export const REPO_CONTRACT_MAX_NEIGHBORS = 6;
export const REPO_CONTRACT_MAX_CHANGED = 8;

export type RepoIndexFreshness = "current" | "partial" | "stale" | "missing";
export type RepoMapLens = "inventory" | "uses";

export type RepoControlSymbol = {
  name: string;
  kind: string;
  relativePath: string;
  exported: boolean;
};

export type RepoControlRoute = {
  method: string;
  routePath: string;
  relativePath: string;
};

export type RepoControlLink = {
  status: "compatible" | "warning" | "breaking" | "unknown";
  linkType: string;
  summary: string;
};

export type RepoControlLanguage = {
  language: string;
  count: number;
};

export type RepoFolderContract = {
  nodeId: RepoMapNodeId;
  label: string;
  fileCount: number;
  languages: RepoControlLanguage[];
  exportedCount: number;
  symbols: RepoControlSymbol[];
  routeCount: number;
  routes: RepoControlRoute[];
  httpClientCount: number;
  packageDepCount: number;
  linkWarningCount: number;
  linkBreakingCount: number;
  links: RepoControlLink[];
  scripts: string[];
  testRunner: string | null;
  changedCount: number;
  changedPaths: string[];
  neighborNodeIds: RepoMapNodeId[];
};

export type RepoRunOverlay = {
  runId: string | null;
  label: string | null;
  href: string | null;
  changedNodeIds: RepoMapNodeId[];
  changedCount: number;
};

export type RepoControlPlane = {
  freshness: RepoIndexFreshness;
  freshnessLabel: string;
  runOverlay: RepoRunOverlay | null;
  contracts: Record<string, RepoFolderContract>;
};

export type RepoControlFacts = {
  files: Array<{ relativePath: string; language: string | null }>;
  symbols: Array<{ name: string; kind: string; relativePath: string; exported: boolean }>;
  surfaces: Array<{
    surfaceType: string;
    method: string | null;
    routePath: string | null;
    name: string | null;
    relativePath: string;
  }>;
  links: Array<{
    status: string;
    linkType: string;
    summary: string;
    sourceRelativePath: string | null;
    targetRelativePath: string | null;
    sourceRepoId: string;
    targetRepoId: string;
  }>;
  chunks: Array<{ relativePath: string; contentPreview: string }>;
  scripts: string[];
  testRunner: string | null;
  fileIndexedAt: string | null;
  codeIndexedAt: string | null;
  changedPaths: string[];
  runId: string | null;
  runLabel: string | null;
};

const IMPORT_SPEC = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

export function emptyRepoControlFacts(): RepoControlFacts {
  return {
    files: [],
    symbols: [],
    surfaces: [],
    links: [],
    chunks: [],
    scripts: [],
    testRunner: null,
    fileIndexedAt: null,
    codeIndexedAt: null,
    changedPaths: [],
    runId: null,
    runLabel: null,
  };
}

export function emptyRepoControlPlane(): RepoControlPlane {
  return {
    freshness: "missing",
    freshnessLabel: "No file index",
    runOverlay: null,
    contracts: {},
  };
}

export function folderPrefixFromNodeId(nodeId: RepoMapNodeId): string {
  if (nodeId === "repo") return "";
  return nodeId.startsWith("folder:") ? nodeId.slice("folder:".length) : "";
}

export function isCodeSymbolKind(kind: string): boolean {
  return !/^heading_\d+$/i.test(kind.trim());
}

export function publicRelativePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.split("\\").join("/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || /^[a-zA-Z]:/.test(normalized)) return null;
  if (normalized.startsWith("home/") || normalized.startsWith("mnt/") || normalized.startsWith("tmp/")) {
    return null;
  }
  return normalized;
}

export function pathMatchesFolder(relativePath: string, prefix: string): boolean {
  const normalized = publicRelativePath(relativePath);
  if (!normalized) return false;
  if (!prefix) return true;
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

export function collectRepoMapNodeIds(map: RepoVisualMap): RepoMapNodeId[] {
  const ids: RepoMapNodeId[] = ["repo"];
  for (const folder of map.folders) {
    ids.push(folder.id as RepoMapNodeId);
    for (const child of folder.children) {
      ids.push(child.id as RepoMapNodeId);
    }
  }
  return ids;
}

export function nodeIdForPath(relativePath: string, nodeIds: RepoMapNodeId[]): RepoMapNodeId {
  const normalized = publicRelativePath(relativePath);
  if (!normalized) return "repo";
  let best: RepoMapNodeId = "repo";
  let bestLength = -1;
  for (const nodeId of nodeIds) {
    const prefix = folderPrefixFromNodeId(nodeId);
    if (!prefix) continue;
    if (pathMatchesFolder(normalized, prefix) && prefix.length > bestLength) {
      best = nodeId;
      bestLength = prefix.length;
    }
  }
  return best;
}

export function extractImportSpecs(preview: string): string[] {
  const specs: string[] = [];
  IMPORT_SPEC.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPEC.exec(preview)) !== null) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

export function resolveRelativeImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const from = publicRelativePath(fromFile);
  if (!from) return null;
  const parts = from.split("/");
  parts.pop();
  for (const piece of spec.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(piece);
  }
  const joined = parts.join("/").replace(/\.(?:[cm]?[jt]sx?|json)$/i, "");
  return joined || null;
}

function take<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function publicLinkStatus(status: string): RepoControlLink["status"] {
  if (status === "compatible" || status === "warning" || status === "breaking" || status === "unknown") {
    return status;
  }
  return "unknown";
}

function publicLinkSummary(summary: string): string {
  return summary
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s]+/g, "…")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)[^\s]*/g, "…")
    .slice(0, 160);
}

function languageCounts(files: Array<{ language: string | null }>): RepoControlLanguage[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = file.language || "unknown";
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((left, right) => right.count - left.count || left.language.localeCompare(right.language))
    .slice(0, 5);
}

export function resolveRepoIndexFreshness(input: {
  fileCount: number;
  symbolCount: number;
  surfaceCount: number;
  fileIndexedAt: string | null;
  codeIndexedAt: string | null;
}): { freshness: RepoIndexFreshness; freshnessLabel: string } {
  if (input.fileCount === 0) {
    return { freshness: "missing", freshnessLabel: "No file index" };
  }
  if (input.fileIndexedAt && input.codeIndexedAt && input.fileIndexedAt > input.codeIndexedAt) {
    return { freshness: "stale", freshnessLabel: "Code index older than files" };
  }
  if (input.symbolCount === 0 && input.surfaceCount === 0) {
    return { freshness: "partial", freshnessLabel: "Files indexed · code index missing" };
  }
  return { freshness: "current", freshnessLabel: "File and code index ready" };
}

function contractLabel(nodeId: RepoMapNodeId, map: RepoVisualMap): string {
  if (nodeId === "repo") return map.name;
  const prefix = folderPrefixFromNodeId(nodeId);
  const parts = prefix.split("/").filter(Boolean);
  return parts[parts.length - 1] || map.name;
}

function visualFileCount(map: RepoVisualMap, nodeId: RepoMapNodeId): number {
  if (nodeId === "repo") return map.fileCount;
  for (const folder of map.folders) {
    if (folder.id === nodeId) return folder.fileCount;
    for (const child of folder.children) {
      if (child.id === nodeId) return child.fileCount;
    }
  }
  return 0;
}

function emptyContract(nodeId: RepoMapNodeId, label: string): RepoFolderContract {
  return {
    nodeId,
    label,
    fileCount: 0,
    languages: [],
    exportedCount: 0,
    symbols: [],
    routeCount: 0,
    routes: [],
    httpClientCount: 0,
    packageDepCount: 0,
    linkWarningCount: 0,
    linkBreakingCount: 0,
    links: [],
    scripts: [],
    testRunner: null,
    changedCount: 0,
    changedPaths: [],
    neighborNodeIds: [],
  };
}

export function buildRepoControlPlane(input: {
  repoId: string;
  visual: RepoVisualMap;
  facts: RepoControlFacts;
}): RepoControlPlane {
  const nodeIds = collectRepoMapNodeIds(input.visual);
  const files = input.facts.files
    .map((file) => ({ ...file, relativePath: publicRelativePath(file.relativePath) }))
    .filter((file): file is { relativePath: string; language: string | null } => Boolean(file.relativePath));
  const symbols = input.facts.symbols
    .map((symbol) => ({ ...symbol, relativePath: publicRelativePath(symbol.relativePath) }))
    .filter((symbol): symbol is RepoControlFacts["symbols"][number] & { relativePath: string } =>
      Boolean(symbol.relativePath),
    );
  const surfaces = input.facts.surfaces
    .map((surface) => ({ ...surface, relativePath: publicRelativePath(surface.relativePath) }))
    .filter((surface): surface is RepoControlFacts["surfaces"][number] & { relativePath: string } =>
      Boolean(surface.relativePath),
    );
  const changedPaths = unique(
    input.facts.changedPaths.map((path) => publicRelativePath(path) ?? "").filter(Boolean),
  );
  const { freshness, freshnessLabel } = resolveRepoIndexFreshness({
    fileCount: files.length,
    symbolCount: symbols.length,
    surfaceCount: surfaces.length,
    fileIndexedAt: input.facts.fileIndexedAt,
    codeIndexedAt: input.facts.codeIndexedAt,
  });

  const contracts: Record<string, RepoFolderContract> = {};
  for (const nodeId of nodeIds) {
    const prefix = folderPrefixFromNodeId(nodeId);
    const folderFiles = files.filter((file) => pathMatchesFolder(file.relativePath, prefix));
    const folderSymbols = symbols.filter((symbol) => pathMatchesFolder(symbol.relativePath, prefix));
    const folderSurfaces = surfaces.filter((surface) => pathMatchesFolder(surface.relativePath, prefix));
    const codeSymbols = folderSymbols.filter((symbol) => isCodeSymbolKind(symbol.kind));
    const exported = codeSymbols.filter((symbol) => symbol.exported);
    const listedSymbols = exported.length > 0 ? exported : codeSymbols;
    const routes = folderSurfaces.filter((surface) => surface.surfaceType === "rest_route" && surface.routePath);
    const folderLinks = input.facts.links.filter((link) => {
      const source = publicRelativePath(link.sourceRelativePath);
      const target = publicRelativePath(link.targetRelativePath);
      const touchesPath =
        (source && pathMatchesFolder(source, prefix)) || (target && pathMatchesFolder(target, prefix));
      const touchesRepo = link.sourceRepoId === input.repoId || link.targetRepoId === input.repoId;
      return nodeId === "repo" ? touchesRepo : Boolean(touchesPath);
    });
    const folderChanged = changedPaths.filter((path) => pathMatchesFolder(path, prefix));
    const contract = emptyContract(nodeId, contractLabel(nodeId, input.visual));
    contract.fileCount = folderFiles.length || visualFileCount(input.visual, nodeId);
    contract.languages = languageCounts(folderFiles);
    contract.exportedCount = exported.length;
    contract.symbols = take(
      listedSymbols.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        relativePath: symbol.relativePath,
        exported: symbol.exported,
      })),
      REPO_CONTRACT_MAX_ITEMS,
    );
    contract.routeCount = routes.length;
    contract.routes = take(
      routes.map((route) => ({
        method: (route.method ?? "GET").toUpperCase(),
        routePath: route.routePath ?? "/",
        relativePath: route.relativePath,
      })),
      REPO_CONTRACT_MAX_ITEMS,
    );
    contract.httpClientCount = folderSurfaces.filter((surface) => surface.surfaceType === "http_client").length;
    contract.packageDepCount = folderSurfaces.filter((surface) => surface.surfaceType === "package_dependency").length;
    contract.linkWarningCount = folderLinks.filter((link) => link.status === "warning").length;
    contract.linkBreakingCount = folderLinks.filter((link) => link.status === "breaking").length;
    contract.links = take(
      folderLinks.map((link) => ({
        status: publicLinkStatus(link.status),
        linkType: link.linkType,
        summary: publicLinkSummary(link.summary),
      })),
      REPO_CONTRACT_MAX_LINKS,
    );
    contract.scripts =
      nodeId === "repo" ? take(unique(input.facts.scripts).sort((left, right) => left.localeCompare(right)), REPO_CONTRACT_MAX_ITEMS) : [];
    contract.testRunner =
      nodeId === "repo" || contract.languages.some((language) => /test/i.test(language.language))
        ? input.facts.testRunner
        : folderPrefixFromNodeId(nodeId).split("/").some((part) => /^(tests?|e2e|spec)$/i.test(part))
          ? input.facts.testRunner
          : null;
    contract.changedCount = folderChanged.length;
    contract.changedPaths = take(folderChanged, REPO_CONTRACT_MAX_CHANGED);
    contracts[nodeId] = contract;
  }

  const neighborsByNode = new Map<RepoMapNodeId, Set<RepoMapNodeId>>();
  const addNeighbor = (from: RepoMapNodeId, to: RepoMapNodeId) => {
    if (from === to) return;
    const bucket = neighborsByNode.get(from) ?? new Set<RepoMapNodeId>();
    bucket.add(to);
    neighborsByNode.set(from, bucket);
  };

  for (const chunk of input.facts.chunks) {
    const fromPath = publicRelativePath(chunk.relativePath);
    if (!fromPath) continue;
    const fromNode = nodeIdForPath(fromPath, nodeIds);
    for (const spec of extractImportSpecs(chunk.contentPreview)) {
      const resolved = resolveRelativeImport(fromPath, spec);
      if (!resolved) continue;
      const toNode = nodeIdForPath(resolved, nodeIds);
      addNeighbor(fromNode, toNode);
      addNeighbor(toNode, fromNode);
    }
  }

  const routesByPath = new Map<string, RepoMapNodeId[]>();
  for (const surface of surfaces) {
    if (surface.surfaceType !== "rest_route" || !surface.routePath) continue;
    const key = `${(surface.method ?? "GET").toUpperCase()} ${surface.routePath}`;
    const list = routesByPath.get(key) ?? [];
    list.push(nodeIdForPath(surface.relativePath, nodeIds));
    routesByPath.set(key, list);
  }
  for (const surface of surfaces) {
    if (surface.surfaceType !== "http_client" || !surface.routePath) continue;
    const key = `${(surface.method ?? "GET").toUpperCase()} ${surface.routePath}`;
    const clientNode = nodeIdForPath(surface.relativePath, nodeIds);
    for (const routeNode of routesByPath.get(key) ?? []) {
      addNeighbor(clientNode, routeNode);
      addNeighbor(routeNode, clientNode);
    }
  }

  for (const nodeId of nodeIds) {
    const neighbors = [...(neighborsByNode.get(nodeId) ?? [])].slice(0, REPO_CONTRACT_MAX_NEIGHBORS);
    contracts[nodeId] = { ...contracts[nodeId]!, neighborNodeIds: neighbors };
  }

  const changedNodeIds = unique(
    changedPaths.flatMap((path) => {
      const exact = nodeIdForPath(path, nodeIds);
      const ancestors = nodeIds.filter((nodeId) => {
        const prefix = folderPrefixFromNodeId(nodeId);
        return prefix.length > 0 && pathMatchesFolder(path, prefix);
      });
      return [exact, ...ancestors];
    }),
  ) as RepoMapNodeId[];
  if (changedPaths.length > 0 && !changedNodeIds.includes("repo")) {
    changedNodeIds.unshift("repo");
  }

  return {
    freshness,
    freshnessLabel,
    runOverlay:
      changedPaths.length > 0 || input.facts.runId
        ? {
            runId: input.facts.runId,
            label: input.facts.runLabel ?? (changedPaths.length > 0 ? `Latest run · ${changedPaths.length} files` : null),
            href: input.facts.runId ? `/engineer/runs/${input.facts.runId}` : null,
            changedNodeIds,
            changedCount: changedPaths.length,
          }
        : null,
    contracts,
  };
}

export function summarizeRepoControlForChat(input: {
  repoName: string;
  freshnessLabel: string;
  contract: RepoFolderContract | null;
  runLabel: string | null;
}): string {
  if (!input.contract) {
    return `${input.repoName}: ${input.freshnessLabel}`;
  }
  const bits = [
    `${input.contract.fileCount} files`,
    input.contract.exportedCount > 0 ? `${input.contract.exportedCount} exports` : null,
    input.contract.routeCount > 0 ? `${input.contract.routeCount} routes` : null,
    input.contract.testRunner ? input.contract.testRunner : null,
    input.runLabel,
  ].filter(Boolean);
  return `${input.repoName} / ${input.contract.label}: ${bits.join(" · ") || input.freshnessLabel}`;
}
