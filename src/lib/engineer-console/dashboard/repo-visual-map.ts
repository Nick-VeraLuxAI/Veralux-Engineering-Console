export const REPO_MAP_MAX_TOP_FOLDERS = 8;
export const REPO_MAP_MAX_CHILDREN = 5;
export const REPO_MAP_NODE_SIZE = { width: 168, height: 72 };
export const REPO_MAP_COLUMN_GAP = 280;
export const REPO_MAP_ROW_GAP = 92;

export type RepoMapFolderKind = "source" | "test" | "docs" | "config" | "other";

export type RepoMapFolder = {
  id: string;
  name: string;
  fileCount: number;
  kind: RepoMapFolderKind;
  children: RepoMapFolder[];
  moreCount: number;
};

export type RepoVisualMap = {
  id: string;
  name: string;
  language: string;
  fileCount: number;
  source: "index" | "folders" | "empty";
  folders: RepoMapFolder[];
};

export type RepoMapNodeId = "repo" | `folder:${string}`;

export type RepoMapPoint = { x: number; y: number };

export type RepoMapLaidOutNode = {
  id: RepoMapNodeId;
  label: string;
  detail: string;
  kind: RepoMapFolderKind | "repo";
  x: number;
  y: number;
};

export type RepoMapEdge = {
  id: string;
  source: RepoMapNodeId;
  target: RepoMapNodeId;
};

const SOURCE_NAMES = new Set([
  "src",
  "app",
  "lib",
  "components",
  "packages",
  "internal",
  "server",
  "client",
  "backend",
  "frontend",
]);
const TEST_NAMES = new Set(["test", "tests", "__tests__", "spec", "e2e"]);
const DOCS_NAMES = new Set(["docs", "documentation", "doc"]);
const CONFIG_NAMES = new Set(["scripts", "tools", "config", "infra", "ops", "ci"]);

export function classifyRepoFolder(name: string): RepoMapFolderKind {
  const key = name.toLowerCase();
  if (SOURCE_NAMES.has(key)) return "source";
  if (TEST_NAMES.has(key)) return "test";
  if (DOCS_NAMES.has(key)) return "docs";
  if (CONFIG_NAMES.has(key)) return "config";
  return "other";
}

function fileLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function takeNamed<T extends { name: string }>(items: T[], limit: number): { kept: T[]; moreCount: number } {
  const sorted = [...items].sort((left, right) => left.name.localeCompare(right.name));
  return {
    kept: sorted.slice(0, limit),
    moreCount: Math.max(0, sorted.length - limit),
  };
}

export function buildRepoVisualMap(input: {
  id: string;
  name: string;
  language: string;
  fileCount: number;
  folders?: string[];
  indexedPaths?: string[];
}): RepoVisualMap {
  const indexedPaths = (input.indexedPaths ?? []).map((entry) => entry.split("\\").join("/")).filter(Boolean);
  if (indexedPaths.length > 0) {
    return {
      id: input.id,
      name: input.name,
      language: input.language,
      fileCount: input.fileCount || indexedPaths.length,
      source: "index",
      folders: foldersFromIndexedPaths(indexedPaths),
    };
  }

  const folders = (input.folders ?? []).filter(Boolean);
  if (folders.length > 0) {
    const { kept, moreCount } = takeNamed(
      folders.map((name) => ({
        id: `folder:${name}`,
        name,
        fileCount: 0,
        kind: classifyRepoFolder(name),
        children: [] as RepoMapFolder[],
        moreCount: 0,
      })),
      REPO_MAP_MAX_TOP_FOLDERS,
    );
    if (moreCount > 0 && kept.length > 0) {
      kept[kept.length - 1] = { ...kept[kept.length - 1], moreCount };
    }
    return {
      id: input.id,
      name: input.name,
      language: input.language,
      fileCount: input.fileCount,
      source: "folders",
      folders: kept,
    };
  }

  return {
    id: input.id,
    name: input.name,
    language: input.language,
    fileCount: input.fileCount,
    source: "empty",
    folders: [],
  };
}

function foldersFromIndexedPaths(paths: string[]): RepoMapFolder[] {
  const top = new Map<string, { files: number; children: Map<string, number> }>();

  for (const relativePath of paths) {
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const topName = parts[0];
    if (topName.startsWith(".")) continue;
    const current = top.get(topName) ?? { files: 0, children: new Map<string, number>() };
    current.files += 1;
    if (parts.length >= 3) {
      const childName = parts[1];
      current.children.set(childName, (current.children.get(childName) ?? 0) + 1);
    }
    top.set(topName, current);
  }

  const { kept, moreCount } = takeNamed(
    [...top.entries()].map(([name, value]) => {
      const children = takeNamed(
        [...value.children.entries()].map(([childName, fileCount]) => ({
          id: `folder:${name}/${childName}`,
          name: childName,
          fileCount,
          kind: classifyRepoFolder(childName),
          children: [] as RepoMapFolder[],
          moreCount: 0,
        })),
        REPO_MAP_MAX_CHILDREN,
      );
      return {
        id: `folder:${name}`,
        name,
        fileCount: value.files,
        kind: classifyRepoFolder(name),
        children: children.kept,
        moreCount: children.moreCount,
      };
    }),
    REPO_MAP_MAX_TOP_FOLDERS,
  );

  if (moreCount > 0 && kept.length > 0) {
    kept[kept.length - 1] = {
      ...kept[kept.length - 1],
      moreCount: kept[kept.length - 1].moreCount + moreCount,
    };
  }
  return kept;
}

export function layoutRepoVisualMap(map: RepoVisualMap): {
  nodes: RepoMapLaidOutNode[];
  edges: RepoMapEdge[];
  size: { width: number; height: number };
} {
  const rowCount = Math.max(1, map.folders.reduce((sum, folder) => sum + Math.max(1, folder.children.length), 0));
  const height = Math.max(640, 200 + rowCount * REPO_MAP_ROW_GAP);
  const width = map.folders.some((folder) => folder.children.length > 0) ? 980 : 700;
  const root: RepoMapLaidOutNode = {
    id: "repo",
    label: map.name,
    detail: [map.language, fileLabel(map.fileCount)].filter(Boolean).join(" · "),
    kind: "repo",
    x: 64,
    y: Math.round(height / 2 - REPO_MAP_NODE_SIZE.height / 2),
  };

  const nodes: RepoMapLaidOutNode[] = [root];
  const edges: RepoMapEdge[] = [];
  let cursorY = 88;

  for (const folder of map.folders) {
    const childSpan = Math.max(1, folder.children.length);
    const folderY = cursorY + ((childSpan - 1) * REPO_MAP_ROW_GAP) / 2;
    nodes.push({
      id: folder.id as RepoMapNodeId,
      label: folder.name,
      detail: folder.moreCount > 0 ? `${fileLabel(folder.fileCount)} · +${folder.moreCount}` : fileLabel(folder.fileCount),
      kind: folder.kind,
      x: 64 + REPO_MAP_COLUMN_GAP,
      y: Math.round(folderY),
    });
    edges.push({
      id: `repo-${folder.id}`,
      source: "repo",
      target: folder.id as RepoMapNodeId,
    });

    folder.children.forEach((child, index) => {
      nodes.push({
        id: child.id as RepoMapNodeId,
        label: child.name,
        detail: fileLabel(child.fileCount),
        kind: child.kind,
        x: 64 + REPO_MAP_COLUMN_GAP * 2,
        y: Math.round(cursorY + index * REPO_MAP_ROW_GAP),
      });
      edges.push({
        id: `${folder.id}-${child.id}`,
        source: folder.id as RepoMapNodeId,
        target: child.id as RepoMapNodeId,
      });
    });

    cursorY += childSpan * REPO_MAP_ROW_GAP;
  }

  return { nodes, edges, size: { width, height } };
}

export function fitRepoMapView(
  layout: { nodes: RepoMapLaidOutNode[]; size: { width: number; height: number } },
  viewport: { width: number; height: number },
): { x: number; y: number; zoom: number } {
  const margin = 48;
  const minX = Math.min(...layout.nodes.map((node) => node.x));
  const minY = Math.min(...layout.nodes.map((node) => node.y));
  const maxX = Math.max(...layout.nodes.map((node) => node.x + REPO_MAP_NODE_SIZE.width));
  const maxY = Math.max(...layout.nodes.map((node) => node.y + REPO_MAP_NODE_SIZE.height));
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const zoom = Math.max(
    0.28,
    Math.min(1.4, (viewport.width - margin * 2) / boundsWidth, (viewport.height - margin * 2) / boundsHeight),
  );
  return {
    x: margin + (viewport.width - margin * 2 - boundsWidth * zoom) / 2 - minX * zoom,
    y: margin + (viewport.height - margin * 2 - boundsHeight * zoom) / 2 - minY * zoom,
    zoom,
  };
}
