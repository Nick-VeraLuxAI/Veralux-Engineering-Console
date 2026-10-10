import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildMappedCodebase, listCodebaseFolders } from "./codebase-map";
import { assertAllowedGhArgs, listGithubRepos } from "./github-access";
import { findLocalGithubClone } from "./import-github-repo";
import { parseGithubRepoRef } from "./github-ref";

describe("github repo access", () => {
  it("parses owner/repo from slugs and URLs", () => {
    expect(parseGithubRepoRef("Nick-VeraLuxAI/Video-Generation")).toEqual({
      owner: "Nick-VeraLuxAI",
      repo: "Video-Generation",
    });
    expect(parseGithubRepoRef("https://github.com/Nick-VeraLuxAI/Video-Generation.git")).toEqual({
      owner: "Nick-VeraLuxAI",
      repo: "Video-Generation",
    });
    expect(parseGithubRepoRef("git@github.com:Nick-VeraLuxAI/Veralux-Engineering-Console.git")).toEqual({
      owner: "Nick-VeraLuxAI",
      repo: "Veralux-Engineering-Console",
    });
    expect(parseGithubRepoRef("not-a-repo")).toBeNull();
  });

  it("summarizes visible top-level folders", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codebase-map-"));
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, ".git"));
    expect(listCodebaseFolders(root)).toEqual(["docs", "src"]);
    expect(buildMappedCodebase({ id: "r1", name: "demo", path: root, language: "TypeScript", fileCount: 0 }).folders).toEqual([
      "docs",
      "src",
    ]);
  });

  it("finds a local clone by origin", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "gh-clone-"));
    const repoPath = path.join(root, "Video-Generation");
    mkdirSync(path.join(repoPath, ".git"), { recursive: true });
    writeFileSync(
      path.join(repoPath, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:Nick-VeraLuxAI/Video-Generation.git\n',
    );
    const previous = process.env.ENGINEER_CONSOLE_GITHUB_CLONE_ROOT;
    process.env.ENGINEER_CONSOLE_GITHUB_CLONE_ROOT = root;
    try {
      expect(findLocalGithubClone({ owner: "Nick-VeraLuxAI", repo: "Video-Generation" })).toBe(repoPath);
    } finally {
      if (previous === undefined) delete process.env.ENGINEER_CONSOLE_GITHUB_CLONE_ROOT;
      else process.env.ENGINEER_CONSOLE_GITHUB_CLONE_ROOT = previous;
    }
  });

  it("lists GitHub repos through the allowlisted gh runner", async () => {
    const listed = await listGithubRepos("", async () =>
      JSON.stringify([
        {
          name: "Video-Generation",
          nameWithOwner: "Nick-VeraLuxAI/Video-Generation",
          description: "Live generator",
          url: "https://github.com/Nick-VeraLuxAI/Video-Generation",
          isPrivate: true,
          updatedAt: "2026-08-22T00:00:00Z",
          primaryLanguage: { name: "TypeScript" },
        },
      ]),
    );
    expect(listed[0]).toMatchObject({
      name: "Video-Generation",
      nameWithOwner: "Nick-VeraLuxAI/Video-Generation",
      language: "TypeScript",
    });
    expect(() => assertAllowedGhArgs(["pr", "create"])).toThrow(/not allowed/);
  });
});
