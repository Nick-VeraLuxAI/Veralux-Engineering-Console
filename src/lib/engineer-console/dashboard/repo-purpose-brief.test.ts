import { describe, expect, it } from "vitest";
import { isCodeSymbolKind } from "./repo-control-plane";
import {
  buildRepoPurposeBrief,
  excerptReadme,
  publicPurposeText,
  takePurposeExports,
  takePurposeRoutes,
} from "./repo-purpose-brief";

describe("repo purpose brief", () => {
  it("sanitizes workstation paths and local URLs", () => {
    expect(
      publicPurposeText("See /home/ndesantis/Documents/PURE-POWER and http://127.0.0.1:3000/app"),
    ).not.toMatch(/home\/ndesantis|127\.0\.0\.1|localhost/);
    expect(publicPurposeText("TOKEN=supersecret value")).toContain("[redacted]");
  });

  it("keeps README purpose lines and drops badges and install steps", () => {
    const excerpt = excerptReadme(
      [
        "# Pure Power Portal",
        "",
        "[![ci](https://img.shields.io/ci)](https://example.com)",
        "",
        "A portal for field operators.",
        "## Stack",
        "- Backend: FastAPI",
        "## Quick start (local)",
        "1. set `MONGO_URL`.",
        "2. uvicorn --host 0.0.0.0 --port 8002",
      ].join("\n"),
    );
    expect(excerpt).toContain("Pure Power Portal");
    expect(excerpt).toContain("A portal for field operators.");
    expect(excerpt).toContain("Backend: FastAPI");
    expect(excerpt).not.toContain("img.shields.io");
    expect(excerpt).not.toContain("Quick start");
    expect(excerpt).not.toContain("MONGO_URL");
    expect(excerpt).not.toContain("0.0.0.0");
  });

  it("takes real routes and code exports, not markdown headings", () => {
    expect(
      takePurposeRoutes([
        { surfaceType: "rest_route", method: "get", routePath: "/health" },
        { surfaceType: "http_client", method: "get", routePath: "/health" },
        { surfaceType: "rest_route", method: "post", routePath: "/api/jobs" },
      ]),
    ).toEqual([
      { method: "GET", routePath: "/health" },
      { method: "POST", routePath: "/api/jobs" },
    ]);
    expect(
      takePurposeExports([
        { name: "unknown heading_1", kind: "heading_1", exported: true },
        { name: "createJob", kind: "function", exported: true },
        { name: "hidden", kind: "function", exported: false },
        { name: "JobRunner", kind: "class", exported: true },
      ]).map((item) => item.name),
    ).toEqual(["createJob", "JobRunner"]);
    expect(isCodeSymbolKind("heading_1")).toBe(false);
    expect(isCodeSymbolKind("function")).toBe(true);
  });

  it("tells Vera what the working repo is for without confusing it with the console", () => {
    const brief = buildRepoPurposeBrief({
      name: "PURE-POWER",
      language: "TypeScript",
      registeredDescription: "Field operations portal",
      packageDescription: "unused when registered description exists",
      readmeExcerpt: "# Pure Power Portal\nA portal for field operators.",
      folders: ["backend", "frontend", "docs"],
      routes: [{ method: "GET", routePath: "/health" }],
      exports: [
        { name: "createJob", kind: "function" },
        { name: "ignored", kind: "heading_1" },
      ],
      scripts: ["test", "lint"],
      testRunner: "vitest",
    });

    expect(brief).toContain("Working repository: PURE-POWER");
    expect(brief).toContain("not the Engineering Console host");
    expect(brief).toContain("Purpose: A portal for field operators.");
    expect(brief).toContain("Pure Power Portal");
    expect(brief).toContain("Layout: backend, frontend, docs");
    expect(brief).toContain("GET /health");
    expect(brief).toContain("createJob");
    expect(brief).not.toContain("ignored");
    expect(brief).toMatch(/Do not ask the operator what the repo is for/);
    expect(brief).not.toMatch(/\/home\/|localhost|127\.0\.0\.1/);
  });

  it("prefers the README paragraph over a GitHub pointer and skips unknown labels", () => {
    const brief = buildRepoPurposeBrief({
      name: "PURE-POWER",
      language: "unknown",
      registeredDescription: "GitHub Nick-VeraLuxAI/PURE-POWER",
      packageDescription: "",
      readmeExcerpt: "# Pure Power Portal\nInternal operations portal for crews.\n## Quick start\nset `MONGO_URL`",
      folders: ["backend"],
      routes: [],
      exports: [],
      scripts: [],
      testRunner: "unknown",
    });
    expect(brief).toContain("Purpose: Internal operations portal for crews.");
    expect(brief).not.toContain("GitHub Nick-VeraLuxAI");
    expect(brief).not.toContain("(unknown)");
    expect(brief).not.toContain("Test runner: unknown");
    expect(brief).not.toContain("MONGO_URL");
  });

  it("does not invent a product story when purpose text is missing", () => {
    const brief = buildRepoPurposeBrief({
      name: "scratch",
      language: "TypeScript",
      registeredDescription: "",
      packageDescription: "",
      readmeExcerpt: "",
      folders: ["src"],
      routes: [],
      exports: [],
      scripts: [],
      testRunner: null,
    });
    expect(brief).toMatch(/Purpose is not recorded/);
    expect(brief).toMatch(/Do not invent a product story/);
  });
});
