import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coerceWorkerPlanToWorktree,
  listAuthorizedWorktreeFiles,
  truncatingUpdateErrors,
} from "./plan-worktree-adapter";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";

let tmp: string | null = null;

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function plan(partial: Partial<WorkerPlan> = {}): WorkerPlan {
  return {
    runId: "run-1",
    summary: "test",
    allowedFiles: [],
    operations: [],
    ...partial,
  };
}

describe("coerceWorkerPlanToWorktree", () => {
  it("converts create_file to update_file when the path already exists", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-plan-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/helper.ts"), "old\n");
    const coerced = coerceWorkerPlanToWorktree(
      tmp,
      plan({
        operations: [
          {
            type: "create_file",
            path: "src/helper.ts",
            content: "new\n",
            reason: "replace",
          },
        ],
      }),
    );
    expect(coerced.operations[0]?.type).toBe("update_file");
    expect(coerced.allowedFiles).toContain("src/helper.ts");
  });

  it("converts update_file and append_file to create_file when the path is missing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-plan-"));
    const coerced = coerceWorkerPlanToWorktree(
      tmp,
      plan({
        operations: [
          {
            type: "update_file",
            path: "src/new.ts",
            content: "ok\n",
            reason: "add",
          },
          {
            type: "append_file",
            path: "src/also.ts",
            content: "ok\n",
            reason: "add",
          },
        ],
      }),
    );
    expect(coerced.operations.map((operation) => operation.type)).toEqual([
      "create_file",
      "create_file",
    ]);
  });

  it("rejects truncated rewrites of large existing files", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-plan-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/loop.ts"), "x".repeat(4000));
    const errors = truncatingUpdateErrors(
      tmp,
      plan({
        operations: [
          {
            type: "update_file",
            path: "src/loop.ts",
            content: "export const broken = true;\n",
            reason: "rewrite",
          },
        ],
      }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/truncates src\/loop\.ts/);
  });

  it("rejects appends onto large existing modules", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-plan-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/loop.ts"), "x".repeat(4000));
    const errors = truncatingUpdateErrors(
      tmp,
      plan({
        operations: [
          {
            type: "append_file",
            path: "src/loop.ts",
            content: "export const extra = true;\n",
            reason: "hook",
          },
        ],
      }),
    );
    expect(errors[0]).toMatch(/appends to large file src\/loop\.ts/);
  });

  it("lists authorized files for planning context", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-plan-"));
    fs.mkdirSync(path.join(tmp, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/lib/a.ts"), "a\n");
    expect(listAuthorizedWorktreeFiles(tmp, ["src/lib/"])).toEqual(["src/lib/a.ts"]);
  });
});
