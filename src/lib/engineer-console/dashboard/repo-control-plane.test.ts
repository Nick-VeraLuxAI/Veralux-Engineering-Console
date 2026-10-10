import { describe, expect, it } from "vitest";
import {
  buildRepoControlPlane,
  emptyRepoControlFacts,
  extractImportSpecs,
  nodeIdForPath,
  pathMatchesFolder,
  publicRelativePath,
  resolveRelativeImport,
  resolveRepoIndexFreshness,
  summarizeRepoControlForChat,
} from "./repo-control-plane";
import { buildRepoVisualMap } from "./repo-visual-map";

describe("repo control plane", () => {
  it("keeps only public relative paths", () => {
    expect(publicRelativePath("src/lib/map.ts")).toBe("src/lib/map.ts");
    expect(publicRelativePath("/home/ndesantis/repo/src/a.ts")).toBeNull();
    expect(publicRelativePath("../secret")).toBeNull();
    expect(publicRelativePath("C:\\repo\\src\\a.ts")).toBeNull();
    expect(pathMatchesFolder("src/lib/a.ts", "src")).toBe(true);
    expect(pathMatchesFolder("docs/guide.md", "src")).toBe(false);
  });

  it("resolves one-hop relative imports onto folder nodes", () => {
    expect(extractImportSpecs(`import { x } from "../app/page";\nrequire("./local")`)).toEqual([
      "../app/page",
      "./local",
    ]);
    expect(resolveRelativeImport("src/lib/map.ts", "../app/page")).toBe("src/app/page");
    expect(resolveRelativeImport("src/lib/map.ts", "react")).toBeNull();
    expect(
      nodeIdForPath("src/lib/map.ts", ["repo", "folder:src", "folder:src/lib", "folder:docs"]),
    ).toBe("folder:src/lib");
  });

  it("classifies index freshness without dumping file contents", () => {
    expect(resolveRepoIndexFreshness({
      fileCount: 0,
      symbolCount: 0,
      surfaceCount: 0,
      fileIndexedAt: null,
      codeIndexedAt: null,
    }).freshness).toBe("missing");
    expect(resolveRepoIndexFreshness({
      fileCount: 4,
      symbolCount: 0,
      surfaceCount: 0,
      fileIndexedAt: "2026-08-23T00:00:00.000Z",
      codeIndexedAt: null,
    }).freshness).toBe("partial");
    expect(resolveRepoIndexFreshness({
      fileCount: 4,
      symbolCount: 2,
      surfaceCount: 0,
      fileIndexedAt: "2026-08-23T12:00:00.000Z",
      codeIndexedAt: "2026-08-23T10:00:00.000Z",
    }).freshness).toBe("stale");
    expect(resolveRepoIndexFreshness({
      fileCount: 4,
      symbolCount: 2,
      surfaceCount: 1,
      fileIndexedAt: "2026-08-23T10:00:00.000Z",
      codeIndexedAt: "2026-08-23T12:00:00.000Z",
    }).freshness).toBe("current");
  });

  it("builds a selected-folder contract from existing index facts", () => {
    const visual = buildRepoVisualMap({
      id: "r1",
      name: "PURE-POWER",
      language: "TypeScript",
      fileCount: 4,
      indexedPaths: [
        "src/lib/map.ts",
        "src/app/page.ts",
        "backend/routes/health.ts",
        "docs/guide.md",
      ],
    });
    const plane = buildRepoControlPlane({
      repoId: "r1",
      visual,
      facts: {
        ...emptyRepoControlFacts(),
        files: [
          { relativePath: "src/lib/map.ts", language: "typescript" },
          { relativePath: "src/app/page.ts", language: "typescript" },
          { relativePath: "backend/routes/health.ts", language: "typescript" },
          { relativePath: "docs/guide.md", language: "markdown" },
        ],
        symbols: [
          { name: "buildMap", kind: "function", relativePath: "src/lib/map.ts", exported: true },
          { name: "hidden", kind: "function", relativePath: "src/lib/map.ts", exported: false },
        ],
        surfaces: [
          {
            surfaceType: "rest_route",
            method: "get",
            routePath: "/health",
            name: "health",
            relativePath: "backend/routes/health.ts",
          },
          {
            surfaceType: "http_client",
            method: "get",
            routePath: "/health",
            name: null,
            relativePath: "src/lib/map.ts",
          },
        ],
        links: [
          {
            status: "warning",
            linkType: "rest_client_to_route",
            summary: "frontend calls /health",
            sourceRelativePath: "src/lib/map.ts",
            targetRelativePath: "backend/routes/health.ts",
            sourceRepoId: "r1",
            targetRepoId: "r2",
          },
        ],
        chunks: [
          { relativePath: "src/lib/map.ts", contentPreview: `import { Page } from "../app/page";` },
        ],
        scripts: ["test", "lint"],
        testRunner: "vitest",
        fileIndexedAt: "2026-08-23T10:00:00.000Z",
        codeIndexedAt: "2026-08-23T11:00:00.000Z",
        changedPaths: ["src/lib/map.ts"],
        runId: "run-1",
        runLabel: "Latest run · 1 files",
      },
    });

    expect(plane.freshness).toBe("current");
    expect(plane.runOverlay?.changedNodeIds).toEqual(expect.arrayContaining(["repo", "folder:src", "folder:src/lib"]));
    expect(plane.runOverlay?.href).toBe("/engineer/runs/run-1");

    const srcLib = plane.contracts["folder:src/lib"];
    expect(srcLib?.exportedCount).toBe(1);
    expect(srcLib?.symbols.map((symbol) => symbol.name)).toEqual(["buildMap"]);
    expect(srcLib?.httpClientCount).toBe(1);
    expect(srcLib?.changedPaths).toEqual(["src/lib/map.ts"]);

    const backend = plane.contracts["folder:backend"];
    const backendRoutes = plane.contracts["folder:backend/routes"];
    expect(backend?.routeCount).toBe(1);
    expect(backend?.routes[0]).toMatchObject({ method: "GET", routePath: "/health" });
    expect(backendRoutes?.neighborNodeIds).toContain("folder:src/lib");
    expect(srcLib?.neighborNodeIds).toEqual(expect.arrayContaining(["folder:src/app", "folder:backend/routes"]));

    const root = plane.contracts.repo;
    expect(root?.scripts).toEqual(["lint", "test"]);
    expect(root?.testRunner).toBe("vitest");
    expect(root?.linkWarningCount).toBe(1);
    expect(JSON.stringify(plane)).not.toContain("/home/");
    expect(JSON.stringify(plane)).not.toContain("localhost");

    expect(
      summarizeRepoControlForChat({
        repoName: "PURE-POWER",
        freshnessLabel: plane.freshnessLabel,
        contract: srcLib ?? null,
        runLabel: plane.runOverlay?.label ?? null,
      }),
    ).toContain("PURE-POWER / lib");
  });

  it("uses the visual file count when index facts are empty", () => {
    const visual = buildRepoVisualMap({
      id: "r1",
      name: "demo",
      language: "TypeScript",
      fileCount: 3,
      indexedPaths: ["src/a.ts", "src/b.ts", "docs/c.md"],
    });
    const plane = buildRepoControlPlane({
      repoId: "r1",
      visual,
      facts: emptyRepoControlFacts(),
    });
    expect(plane.freshness).toBe("missing");
    expect(plane.contracts.repo?.fileCount).toBe(3);
    expect(plane.contracts["folder:src"]?.fileCount).toBe(2);
  });

  it("does not put every store onto the root contract lists", () => {
    const visual = buildRepoVisualMap({
      id: "r1",
      name: "demo",
      language: "TypeScript",
      fileCount: 20,
      indexedPaths: Array.from({ length: 12 }, (_, index) => `src/f${index}.ts`),
    });
    const plane = buildRepoControlPlane({
      repoId: "r1",
      visual,
      facts: {
        ...emptyRepoControlFacts(),
        files: Array.from({ length: 12 }, (_, index) => ({
          relativePath: `src/f${index}.ts`,
          language: "typescript",
        })),
        symbols: Array.from({ length: 20 }, (_, index) => ({
          name: `sym${index}`,
          kind: "function",
          relativePath: `src/f${index % 12}.ts`,
          exported: true,
        })),
      },
    });
    expect(plane.contracts.repo?.exportedCount).toBe(20);
    expect(plane.contracts.repo?.symbols).toHaveLength(8);
  });

  it("does not count markdown headings as exported code", () => {
    const visual = buildRepoVisualMap({
      id: "r1",
      name: "PURE-POWER",
      language: "TypeScript",
      fileCount: 2,
      indexedPaths: ["src/app.ts", "docs/guide.md"],
    });
    const plane = buildRepoControlPlane({
      repoId: "r1",
      visual,
      facts: {
        ...emptyRepoControlFacts(),
        files: [
          { relativePath: "src/app.ts", language: "typescript" },
          { relativePath: "docs/guide.md", language: "markdown" },
        ],
        symbols: [
          { name: "createJob", kind: "function", relativePath: "src/app.ts", exported: true },
          { name: "Pure Power Portal", kind: "heading_1", relativePath: "docs/guide.md", exported: true },
          { name: "unknown heading_1", kind: "heading_1", relativePath: "docs/guide.md", exported: true },
        ],
      },
    });
    expect(plane.contracts.repo?.exportedCount).toBe(1);
    expect(plane.contracts.repo?.symbols.map((symbol) => symbol.name)).toEqual(["createJob"]);
    expect(plane.contracts["folder:docs"]?.exportedCount).toBe(0);
    expect(plane.contracts["folder:docs"]?.symbols).toEqual([]);
  });
});

