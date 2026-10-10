import { describe, expect, it } from "vitest";
import {
  buildRepoVisualMap,
  classifyRepoFolder,
  fitRepoMapView,
  layoutRepoVisualMap,
} from "./repo-visual-map";

describe("repo visual map", () => {
  it("classifies common codebase folders", () => {
    expect(classifyRepoFolder("src")).toBe("source");
    expect(classifyRepoFolder("backend")).toBe("source");
    expect(classifyRepoFolder("frontend")).toBe("source");
    expect(classifyRepoFolder("tests")).toBe("test");
    expect(classifyRepoFolder("docs")).toBe("docs");
    expect(classifyRepoFolder("scripts")).toBe("config");
    expect(classifyRepoFolder("vendor")).toBe("other");
  });

  it("builds a two-level tree from indexed paths and hides leftover folders", () => {
    const map = buildRepoVisualMap({
      id: "r1",
      name: "PURE-POWER",
      language: "TypeScript",
      fileCount: 6,
      folders: ["should-not-win"],
      indexedPaths: [
        "src/app/page.tsx",
        "src/lib/map.ts",
        "docs/guide.md",
        "tests/map.test.ts",
        ".github/workflows/ci.yml",
        "README.md",
      ],
    });

    expect(map.source).toBe("index");
    expect(map.folders.map((folder) => folder.name)).toEqual(["docs", "src", "tests"]);
    expect(map.folders.find((folder) => folder.name === "src")?.children.map((child) => child.name)).toEqual([
      "app",
      "lib",
    ]);
    expect(map.folders.find((folder) => folder.name === "src")?.fileCount).toBe(2);
  });

  it("falls back to top-level folders when no index exists", () => {
    const map = buildRepoVisualMap({
      id: "r1",
      name: "demo",
      language: "TypeScript",
      fileCount: 0,
      folders: ["docs", "src"],
    });

    expect(map.source).toBe("folders");
    expect(map.folders.map((folder) => folder.name)).toEqual(["docs", "src"]);
    expect(map.folders[0].children).toEqual([]);
  });

  it("lays out repo then areas then parts so the tree can be read left to right", () => {
    const map = buildRepoVisualMap({
      id: "r1",
      name: "PURE-POWER",
      language: "TypeScript",
      fileCount: 3,
      indexedPaths: ["src/lib/a.ts", "src/app/b.ts", "docs/c.md"],
    });
    const layout = layoutRepoVisualMap(map);
    const root = layout.nodes.find((node) => node.id === "repo");
    const src = layout.nodes.find((node) => node.id === "folder:src");
    const lib = layout.nodes.find((node) => node.id === "folder:src/lib");

    expect(root?.x).toBeLessThan(src?.x ?? 0);
    expect(src?.x).toBeLessThan(lib?.x ?? 0);
    expect(layout.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "repo->folder:docs",
      "repo->folder:src",
      "folder:src->folder:src/app",
      "folder:src->folder:src/lib",
    ]);
    const fitted = fitRepoMapView(layout, { width: 900, height: 700 });
    expect(fitted.zoom).toBeGreaterThan(0.28);
    expect(fitted.zoom).toBeLessThanOrEqual(1.4);
  });
});
