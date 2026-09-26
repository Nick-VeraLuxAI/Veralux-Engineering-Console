import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask } from "../task-manager/task-manager";
import { createRun } from "../run-manager/run-manager";
import { createIsolatedRunWorktree, seedWorktreeFromHostRepo } from "../workspace/run-worktree";
import { getChangedFiles } from "../workspace/git-workspace";

let tmpDb: string;
let repoRoot: string;
let worktreeRoot: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-wt-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wt-root-"));
  process.env.ENGINEER_CONSOLE_WORKTREE_ROOT = worktreeRoot;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wt-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "root\n");
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(worktreeRoot)) fs.rmSync(worktreeRoot, { recursive: true, force: true });
  if (fs.existsSync(repoRoot)) fs.rmSync(repoRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_WORKTREE_ROOT;
});

describe("concurrent run worktrees", () => {
  it("isolates mutations across two concurrent worktrees", async () => {
    const task = createTask({ title: "iso", targetRepoPath: repoRoot });
    const runA = createRun(task.id);
    const runB = createRun(task.id);
    const branchBefore = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();

    const [wtA, wtB] = await Promise.all([
      createIsolatedRunWorktree({ runId: runA.id, taskId: task.id, repoPath: repoRoot }),
      createIsolatedRunWorktree({ runId: runB.id, taskId: task.id, repoPath: repoRoot }),
    ]);

    expect(wtA.worktreePath).not.toBe(wtB.worktreePath);
    expect(wtA.branchName).not.toBe(wtB.branchName);
    fs.mkdirSync(path.join(wtA.worktreePath, "src"), { recursive: true });
    fs.mkdirSync(path.join(wtB.worktreePath, "src"), { recursive: true });
    fs.writeFileSync(path.join(wtA.worktreePath, "src/a.txt"), "A");
    fs.writeFileSync(path.join(wtB.worktreePath, "src/b.txt"), "B");

    const changedA = await getChangedFiles(wtA.worktreePath);
    const changedB = await getChangedFiles(wtB.worktreePath);
    expect(changedA).toContain("src/a.txt");
    expect(changedA).not.toContain("src/b.txt");
    expect(changedB).toContain("src/b.txt");
    expect(changedB).not.toContain("src/a.txt");
    expect(fs.existsSync(path.join(repoRoot, "src/a.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "src/b.txt"))).toBe(false);
    const branchAfter = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    expect(branchAfter).toBe(branchBefore);
  });

  it("symlinks host node_modules into the isolated worktree for QC", async () => {
    fs.mkdirSync(path.join(repoRoot, "node_modules", "example"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "node_modules", "example", "index.js"), "module.exports = 1;\n");
    const task = createTask({ title: "deps", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    const worktree = await createIsolatedRunWorktree({
      runId: run.id,
      taskId: task.id,
      repoPath: repoRoot,
    });
    const linked = path.join(worktree.worktreePath, "node_modules", "example", "index.js");
    expect(fs.existsSync(linked)).toBe(true);
    expect(fs.lstatSync(path.join(worktree.worktreePath, "node_modules")).isSymbolicLink()).toBe(true);
  });

  it("seeds uncommitted host scaffold into an empty worktree checkout", async () => {
    const hostScaffold = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wt-host-"));
    execSync("git init", { cwd: hostScaffold, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: hostScaffold, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: hostScaffold, stdio: "ignore" });
    fs.mkdirSync(path.join(hostScaffold, "src"), { recursive: true });
    fs.writeFileSync(path.join(hostScaffold, "package.json"), '{"name":"seed-test","scripts":{"test":"vitest run"}}\n');
    fs.writeFileSync(path.join(hostScaffold, "src", "index.ts"), "export const x = 1;\n");

    const task = createTask({ title: "seed", targetRepoPath: hostScaffold });
    const run = createRun(task.id);
    const worktree = await createIsolatedRunWorktree({
      runId: run.id,
      taskId: task.id,
      repoPath: hostScaffold,
    });

    expect(fs.existsSync(path.join(worktree.worktreePath, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(worktree.worktreePath, "src", "index.ts"))).toBe(true);
    const changed = await getChangedFiles(worktree.worktreePath);
    expect(changed).not.toContain("node_modules");
    // Seeded scaffold is committed as baseline — AE scope review must not see it as a mutation.
    expect(changed).not.toContain("package.json");
    expect(changed).not.toContain("src/index.ts");
    expect(changed).toEqual([]);
    fs.rmSync(hostScaffold, { recursive: true, force: true });
  });
});
