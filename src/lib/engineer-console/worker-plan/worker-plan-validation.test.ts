import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  validateWorkerPlan,
  validateWorkerPlanPayload,
} from "./worker-plan-validation";
import type { WorkerPlan } from "./worker-plan-types";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-worker-plan-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function basePlan(overrides: Partial<WorkerPlan> = {}): WorkerPlan {
  return {
    runId: "run-1",
    summary: "Test plan",
    allowedFiles: ["src/example.ts"],
    operations: [
      {
        type: "create_file",
        path: "src/example.ts",
        content: "export const x = 1;\n",
        reason: "init",
      },
    ],
    ...overrides,
  };
}

describe("validateWorkerPlan", () => {
  it("accepts valid create operation", () => {
    const result = validateWorkerPlan(basePlan(), repoRoot, "run-1");
    expect(result.valid).toBe(true);
    expect(result.normalizedOperations).toHaveLength(1);
    expect(result.normalizedOperations[0].path).toBe("src/example.ts");
  });

  it("rejects absolute paths", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["/etc/passwd"],
        operations: [
          {
            type: "create_file",
            path: "/etc/passwd",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ABSOLUTE_PATH")).toBe(true);
  });

  it("rejects ../ traversal", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["../outside.txt"],
        operations: [
          {
            type: "create_file",
            path: "../outside.txt",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "PATH_TRAVERSAL")).toBe(true);
  });

  it("rejects paths escaping repo root", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["subdir/../../outside.txt"],
        operations: [
          {
            type: "create_file",
            path: "subdir/../../outside.txt",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "PATH_TRAVERSAL" || e.code === "PATH_ESCAPES_REPO",
      ),
    ).toBe(true);
  });

  it("rejects .env paths", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: [".env"],
        operations: [
          { type: "create_file", path: ".env", content: "SECRET=1", reason: "bad" },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "PROTECTED_PATH")).toBe(true);
  });

  it("rejects .git paths", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: [".git/config"],
        operations: [
          {
            type: "update_file",
            path: ".git/config",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
  });

  it("rejects node_modules paths", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["node_modules/pkg/index.js"],
        operations: [
          {
            type: "create_file",
            path: "node_modules/pkg/index.js",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
  });

  it("rejects package-lock.json by default", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["package-lock.json"],
        operations: [
          {
            type: "update_file",
            path: "package-lock.json",
            content: "{}",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
  });

  it("allows package-lock when explicitly allowed", () => {
    fs.writeFileSync(path.join(repoRoot, "package-lock.json"), "{}");
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["package-lock.json"],
        operations: [
          {
            type: "update_file",
            path: "package-lock.json",
            content: '{"name":"x"}',
            reason: "ok",
          },
        ],
      }),
      repoRoot,
      "run-1",
      { allowPackageLock: true },
    );
    expect(result.valid).toBe(true);
  });

  it("rejects files outside allowedFiles", () => {
    const result = validateWorkerPlan(
      basePlan({
        allowedFiles: ["src/allowed.ts"],
        operations: [
          {
            type: "create_file",
            path: "src/other.ts",
            content: "x",
            reason: "bad",
          },
        ],
      }),
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NOT_IN_ALLOWED_FILES")).toBe(true);
  });

  it("rejects empty content", () => {
    const result = validateWorkerPlanPayload(
      {
        runId: "run-1",
        summary: "x",
        allowedFiles: ["src/a.ts"],
        operations: [{ type: "create_file", path: "src/a.ts", content: "", reason: "" }],
      },
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "EMPTY_CONTENT")).toBe(true);
  });

  it("rejects delete operations", () => {
    const result = validateWorkerPlanPayload(
      {
        runId: "run-1",
        summary: "x",
        allowedFiles: ["src/a.ts"],
        operations: [{ type: "delete_file", path: "src/a.ts", content: "x", reason: "" }],
      },
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "FORBIDDEN_OPERATION")).toBe(true);
  });

  it("accepts update and append when files exist", () => {
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src/existing.ts"), "old\n");

    const result = validateWorkerPlan(
      {
        runId: "run-1",
        summary: "updates",
        allowedFiles: ["src/existing.ts"],
        operations: [
          {
            type: "update_file",
            path: "src/existing.ts",
            content: "new\n",
            reason: "replace",
          },
          {
            type: "append_file",
            path: "src/existing.ts",
            content: "// tail\n",
            reason: "append",
          },
        ],
      },
      repoRoot,
      "run-1",
    );
    expect(result.valid).toBe(true);
    expect(result.normalizedOperations).toHaveLength(2);
  });
});
