import type { CustomBoundedCodingTask } from "./local-model-coding-task";
import { VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID } from "./local-model-coding-proof-contract";

export type CodingOrchestrationMode = "full_generation" | "scaffold_first";

export type CodingScaffoldFile = {
  relativePath: string;
  content: string;
};

export const RUN_HISTORY_V1_SERVICE_PATH =
  "src/services/vera/vera-builder-loop-run-history.ts" as const;

export const RUN_HISTORY_V1_TEST_PATH =
  "src/services/vera/vera-builder-loop-run-history.test.ts" as const;

export const RUN_HISTORY_V1_SERVICE_CONTRACT = `export type BuilderLoopRunHistoryStage =
  | "manual_integration_candidate"
  | "controlled_apply_dry_run"
  | "controlled_apply_sandbox"
  | "controlled_apply_approval_decision"
  | "real_controlled_apply";

export type BuilderLoopRunHistoryItem = {
  stage: BuilderLoopRunHistoryStage;
  status: string;
  created_at?: string;
  evidence_id?: string;
  candidate_id?: string;
  model_used?: string;
  repair_attempts?: number;
  files_changed?: string[];
  test_result?: string;
  integration_state?: string;
  boundary_flags?: Record<string, boolean>;
  next_action?: string;
  source_file: string;
};

export type BuilderLoopRunHistoryResult = {
  items: BuilderLoopRunHistoryItem[];
  warnings: string[];
  total_records: number;
};

export async function loadBuilderLoopRunHistory(input: {
  workspaceRoot: string;
}): Promise<BuilderLoopRunHistoryResult>;`;

const RUN_HISTORY_STAGE_DIRECTORIES = [
  { stage: "manual_integration_candidate", dir: "builder-loop-manual-integration-candidates" },
  { stage: "controlled_apply_dry_run", dir: "builder-loop-controlled-apply-dry-runs" },
  { stage: "controlled_apply_sandbox", dir: "builder-loop-controlled-apply-sandboxes" },
  { stage: "controlled_apply_approval_decision", dir: "builder-loop-controlled-apply-approval-decisions" },
  { stage: "real_controlled_apply", dir: "builder-loop-controlled-apply-records" },
] as const;

export const RUN_HISTORY_V1_TEST_SCAFFOLD = `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBuilderLoopRunHistory } from "./vera-builder-loop-run-history";

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vera-run-history-"));
}

function writeJson(dir: string, filename: string, value: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), \`\${JSON.stringify(value, null, 2)}\\n\`, "utf8");
}

describe("vera-builder-loop-run-history", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of workspaces.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns empty items for an empty workspace", async () => {
    const workspaceRoot = makeWorkspace();
    workspaces.push(workspaceRoot);
    const result = await loadBuilderLoopRunHistory({ workspaceRoot });
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.total_records).toBe(0);
  });

  it("returns empty items when record directories exist but contain no json files", async () => {
    const workspaceRoot = makeWorkspace();
    workspaces.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, "builder-loop-manual-integration-candidates"), { recursive: true });
    const result = await loadBuilderLoopRunHistory({ workspaceRoot });
    expect(result.items).toEqual([]);
    expect(result.total_records).toBe(0);
  });

  it("normalizes a valid manual integration candidate record", async () => {
    const workspaceRoot = makeWorkspace();
    workspaces.push(workspaceRoot);
    writeJson(
      path.join(workspaceRoot, "builder-loop-manual-integration-candidates"),
      "candidate-1.json",
      {
        schema_version: "vera_builder_loop_manual_integration_candidate_v1",
        candidate_id: "candidate-1",
        created_at: "2026-01-01T00:00:00.000Z",
        request_title: "Builder Loop Run History V1",
        evidence_id: "evidence-1",
        integration_state: "blocked_manual_future",
        test_passed: true,
      },
    );
    const result = await loadBuilderLoopRunHistory({ workspaceRoot });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const item = result.items.find((entry) => entry.candidate_id === "candidate-1");
    expect(item?.stage).toBe("manual_integration_candidate");
    expect(item?.evidence_id).toBe("evidence-1");
    expect(item?.source_file).toContain("candidate-1.json");
    expect(result.total_records).toBe(result.items.length);
  });

  it("tolerates corrupt records with warnings instead of crashing", async () => {
    const workspaceRoot = makeWorkspace();
    workspaces.push(workspaceRoot);
    const recordDir = path.join(workspaceRoot, "builder-loop-controlled-apply-dry-runs");
    fs.mkdirSync(recordDir, { recursive: true });
    fs.writeFileSync(path.join(recordDir, "bad.json"), "{not-json", "utf8");
    const result = await loadBuilderLoopRunHistory({ workspaceRoot });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.items).toEqual([]);
    expect(result.total_records).toBe(0);
  });
});
`;

export function isScaffoldFirstTask(task?: CustomBoundedCodingTask): boolean {
  return task?.orchestration_mode === "scaffold_first";
}

export function resolveModelEditablePaths(task: CustomBoundedCodingTask): string[] {
  if (isScaffoldFirstTask(task) && task.model_editable_files?.length) {
    return [...task.model_editable_files];
  }
  if (task.expected_files?.length) {
    return [...task.expected_files];
  }
  return task.allowed_file_patterns.filter((pattern) => !pattern.includes("*"));
}

export function resolveScaffoldedPaths(task: CustomBoundedCodingTask): string[] {
  if (!isScaffoldFirstTask(task)) return [];
  if (task.scaffolded_files?.length) {
    return task.scaffolded_files.map((file) => file.relativePath);
  }
  return resolvePresetScaffoldFiles(task.coding_task_id).map((file) => file.relativePath);
}

export function resolvePresetScaffoldFiles(codingTaskId: string): CodingScaffoldFile[] {
  if (codingTaskId === VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID) {
    return [{ relativePath: RUN_HISTORY_V1_TEST_PATH, content: RUN_HISTORY_V1_TEST_SCAFFOLD }];
  }
  return [];
}

export function resolveScaffoldFilesForTask(task: CustomBoundedCodingTask): CodingScaffoldFile[] {
  if (!isScaffoldFirstTask(task)) return [];
  if (task.scaffolded_files?.length) {
    return task.scaffolded_files.map((file) => ({
      relativePath: file.relativePath,
      content: file.content,
    }));
  }
  return resolvePresetScaffoldFiles(task.coding_task_id);
}

export function runHistoryStageDirectoryGuide(): string {
  return RUN_HISTORY_STAGE_DIRECTORIES
    .map((entry) => `- ${entry.stage}: ${entry.dir}/`)
    .join("\n");
}
