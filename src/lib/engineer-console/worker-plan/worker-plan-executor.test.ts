import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeWorkerPlanOperations } from "./worker-plan-executor";
import type { NormalizedWorkerOperation } from "./worker-plan-types";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-executor-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function op(
  partial: Omit<NormalizedWorkerOperation, "absolutePath">,
): NormalizedWorkerOperation {
  return {
    ...partial,
    absolutePath: path.resolve(repoRoot, partial.path),
  };
}

describe("executeWorkerPlanOperations", () => {
  it("creates a new file", () => {
    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "create_file",
        path: "src/new.ts",
        content: "export const v = true;\n",
        reason: "create",
      }),
    ]);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "src/new.ts"), "utf8")).toBe(
      "export const v = true;\n",
    );
    expect(result.changedFiles).toContain("src/new.ts");
  });

  it("updates an existing file", () => {
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src/existing.ts"), "old\n");

    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "update_file",
        path: "src/existing.ts",
        content: "new\n",
        reason: "update",
      }),
    ]);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "src/existing.ts"), "utf8")).toBe("new\n");
  });

  it("appends to an existing file", () => {
    fs.writeFileSync(path.join(repoRoot, "notes.md"), "# Title\n");

    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "append_file",
        path: "notes.md",
        content: "\nMore content\n",
        reason: "append",
      }),
    ]);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "notes.md"), "utf8")).toBe(
      "# Title\n\nMore content\n",
    );
  });

  it("fails create_file when file exists", () => {
    fs.writeFileSync(path.join(repoRoot, "exists.txt"), "already");

    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "create_file",
        path: "exists.txt",
        content: "x",
        reason: "create",
      }),
    ]);
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("FILE_EXISTS");
  });

  it("fails update_file when file missing", () => {
    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "update_file",
        path: "missing.ts",
        content: "x",
        reason: "update",
      }),
    ]);
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("FILE_NOT_FOUND");
  });

  it("fails append_file when file missing", () => {
    const result = executeWorkerPlanOperations(repoRoot, [
      op({
        type: "append_file",
        path: "missing.md",
        content: "x",
        reason: "append",
      }),
    ]);
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("FILE_NOT_FOUND");
  });

  it("does not create git commits", () => {
    executeWorkerPlanOperations(repoRoot, [
      op({
        type: "create_file",
        path: "tracked.txt",
        content: "hello\n",
        reason: "create",
      }),
    ]);
    const commitCount = execSync("git rev-list --count HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    expect(commitCount).toBe("1");
  });
});
