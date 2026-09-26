import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { ensureHeadRevision, getHeadRevision, hasHeadRevision } from "./git-workspace";
import { createIsolatedRunWorktree } from "./run-worktree";

function initEmptyRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-empty-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}

describe("empty git repository baseline", () => {
  let repoRoot = "";
  let tmpDb = "";
  let worktreeRoot = "";

  afterEach(() => {
    closeEngineerConsoleDb();
    resetEngineerConsoleDbForTests();
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    if (worktreeRoot && fs.existsSync(worktreeRoot)) {
      fs.rmSync(worktreeRoot, { recursive: true, force: true });
    }
    if (repoRoot && fs.existsSync(repoRoot)) {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_WORKTREE_ROOT;
  });

  it("detects unborn HEAD and creates a baseline commit without adding files", async () => {
    repoRoot = initEmptyRepo();
    fs.writeFileSync(path.join(repoRoot, "README.md"), "draft\n");
    expect(await hasHeadRevision(repoRoot)).toBe(false);
    await expect(getHeadRevision(repoRoot)).rejects.toThrow();

    const sha = await ensureHeadRevision(repoRoot);
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(await hasHeadRevision(repoRoot)).toBe(true);
    expect(await ensureHeadRevision(repoRoot)).toBe(sha);

    const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });

  it("can create an isolated run worktree from a repo with no commits", async () => {
    repoRoot = initEmptyRepo();
    tmpDb = path.join(os.tmpdir(), `ec-empty-wt-${Date.now()}.db`);
    worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-empty-wt-root-"));
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_WORKTREE_ROOT = worktreeRoot;
    resetEngineerConsoleDbForTests();
    initializeEngineerConsoleDatabase();

    const task = createTask({ title: "empty repo run", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    const worktree = await createIsolatedRunWorktree({
      runId: run.id,
      taskId: task.id,
      repoPath: repoRoot,
    });

    expect(worktree.baseRevision).toMatch(/^[0-9a-f]{7,40}$/);
    expect(fs.existsSync(worktree.worktreePath)).toBe(true);
    expect(await hasHeadRevision(worktree.worktreePath)).toBe(true);
  });
});
