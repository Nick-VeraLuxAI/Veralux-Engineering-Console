import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectRepoContext,
  DEFAULT_MAX_FILE_BYTES,
} from "./repo-context-collector";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ctx-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src/safe.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=1\n");
  fs.mkdirSync(path.join(repoRoot, "node_modules/pkg"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "node_modules/pkg/index.js"), "module.exports = {};\n");
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run" } }),
  );
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("collectRepoContext", () => {
  it("skips protected paths in file tree", async () => {
    const ctx = await collectRepoContext({ repoPath: repoRoot });
    expect(ctx.fileTree.some((e) => e.includes("node_modules"))).toBe(false);
    expect(ctx.fileTree.some((e) => e.includes(".env"))).toBe(false);
    expect(ctx.fileTree.some((e) => e.includes(".git"))).toBe(false);
  });

  it("skips protected paths when reading file contents", async () => {
    const ctx = await collectRepoContext({
      repoPath: repoRoot,
      includeFileContents: [".env", "src/safe.ts"],
    });
    expect(ctx.fileContents.some((f) => f.path === "src/safe.ts")).toBe(true);
    expect(ctx.fileContents.some((f) => f.path === ".env")).toBe(false);
    expect(ctx.skippedFiles.some((s) => s.path === ".env")).toBe(true);
  });

  it("respects max file size", async () => {
    const bigPath = path.join(repoRoot, "src/big.txt");
    fs.writeFileSync(bigPath, "x".repeat(DEFAULT_MAX_FILE_BYTES + 100));
    const ctx = await collectRepoContext({
      repoPath: repoRoot,
      includeFileContents: ["src/big.txt"],
      maxFileBytes: 100,
    });
    expect(ctx.fileContents.length).toBe(0);
    expect(ctx.skippedFiles.some((s) => s.path === "src/big.txt")).toBe(true);
  });

  it("includes package scripts", async () => {
    const ctx = await collectRepoContext({ repoPath: repoRoot });
    expect(ctx.packageScripts.test).toBe("vitest run");
  });
});
