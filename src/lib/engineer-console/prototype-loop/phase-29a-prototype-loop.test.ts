import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getRunById, getQualityGateResultsForRun } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import {
  PHASE_29A_APPROVAL_QUESTION,
  createPhase29ABuildSpec,
  runPhase29APrototypeLoop,
  validatePhase29ABuildSpec,
} from "./phase-29a-prototype-loop";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase-29a-"));
  tempRoots.push(root);
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(root, "engineer-console.db");
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(async () => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (originalDbPath === undefined) {
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
  } else {
    process.env.ENGINEER_CONSOLE_DB_PATH = originalDbPath;
  }
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase-29a-repo-"));
  tempRoots.push(root);
  return root;
}

describe("Phase 29A Prototype Loop v1", () => {
  it("creates and validates the required structured build spec", () => {
    const spec = createPhase29ABuildSpec("Build the word-count proof CLI.");

    expect(() => validatePhase29ABuildSpec(spec)).not.toThrow();
    expect(spec).toMatchObject({
      task_type: "build_prototype",
      title: "Tiny Word Count CLI Prototype",
      user_intent: "Build the word-count proof CLI.",
      target_proof_task: expect.stringContaining("word count"),
      approval_policy: {
        approval_required: true,
        implementation_allowed_without_approval: false,
        final_options: ["approve implementation", "request revision", "discard"],
      },
    });
    expect(spec.allowed_change_scope).toContain(".prototype-loop/<task-id>/");
    expect(spec.disallowed_changes).toContain("production source integration");
    expect(spec.required_checks).toContain("node --test word-count-cli.test.mjs");
    expect(spec.evidence_requirements).toEqual(expect.arrayContaining([
      "structured spec",
      "run/task id or equivalent tracking id",
      "acceptance criteria pass/fail status",
      "readiness status",
    ]));
  });

  it("creates Console task/run tracking, builds in the safe prototype path, and enriches evidence", async () => {
    const repoRoot = await tempRepo();
    const result = await runPhase29APrototypeLoop({
      repoRoot,
      request: "Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.",
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    const task = getTaskById(result.console_tracking.task_id);
    const run = getRunById(result.console_tracking.run_id);
    const gates = getQualityGateResultsForRun(result.console_tracking.run_id);

    expect(result.status).toBe("ready_for_user_approval");
    expect(task?.status).toBe("waiting_for_approval");
    expect(run?.status).toBe("waiting_for_approval");
    expect(gates.map((gate) => gate.command)).toContain("node --test word-count-cli.test.mjs");
    expect(result.workspace_path).toBe(path.join(repoRoot, ".prototype-loop", result.console_tracking.task_id));
    expect(result.evidence_path).toBe(path.join(repoRoot, "evidence", "prototype-loop-v1", `${result.console_tracking.task_id}.json`));
    expect(result.evidence.files_created_or_changed).toEqual([
      `.prototype-loop/${result.console_tracking.task_id}/word-count-cli.mjs`,
      `.prototype-loop/${result.console_tracking.task_id}/word-count-cli.test.mjs`,
      `.prototype-loop/${result.console_tracking.task_id}/sample.txt`,
    ]);
    expect(result.evidence.diff_scope_check.status).toBe("passed");
    expect(result.evidence.integration_performed).toBe(false);
    expect(result.evidence.approval_required).toBe(true);
    expect(result.evidence.console_tracking).toEqual(result.console_tracking);
    expect(result.evidence.structured_build_spec.task_type).toBe("build_prototype");
    expect(result.evidence.acceptance_criteria_status.every((criterion) => criterion.status === "passed")).toBe(true);
    expect(result.vera_summary.approval_question).toBe(PHASE_29A_APPROVAL_QUESTION);
    expect(result.approval_options).toEqual(["approve implementation", "request revision", "discard"]);
  });

  it("implements the tiny CLI behavior against the generated fixture", async () => {
    const repoRoot = await tempRepo();
    const result = await runPhase29APrototypeLoop({ repoRoot });
    const output = execFileSync(
      process.execPath,
      ["word-count-cli.mjs", "sample.txt"],
      { cwd: result.workspace_path, encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as {
      wordCount: number;
      characterCount: number;
      topRepeatedWords: Array<{ word: string; count: number }>;
    };

    expect(parsed.wordCount).toBe(10);
    expect(parsed.characterCount).toBeGreaterThan(0);
    expect(parsed.topRepeatedWords.slice(0, 3)).toEqual([
      { word: "tiny", count: 3 },
      { word: "builds", count: 2 },
      { word: "hello", count: 2 },
    ]);
  });

  it("writes the exact Vera-style approval summary to evidence", async () => {
    const repoRoot = await tempRepo();
    const result = await runPhase29APrototypeLoop({ repoRoot });
    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as typeof result.evidence;

    expect(evidence.vera_summary).toEqual(result.vera_summary);
    expect(evidence.vera_summary.what_was_built).toContain("tiny Node.js CLI");
    expect(evidence.vera_summary.where_it_was_built).toBe(result.workspace_path);
    expect(evidence.vera_summary.what_passed.join("\n")).toContain("prototype_tests");
    expect(evidence.vera_summary.risks_or_limitations.join("\n")).toContain("not been integrated");
    expect(evidence.vera_summary.approval_question).toBe(PHASE_29A_APPROVAL_QUESTION);
  });
});
