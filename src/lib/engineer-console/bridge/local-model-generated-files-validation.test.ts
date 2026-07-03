import { describe, expect, it } from "vitest";
import {
  listAllowedPathsForTask,
  validateGeneratedFilesForTask,
} from "./local-model-generated-files-validation";
import { resolveCodingTaskSpec } from "./local-model-coding-task";
import { VERA_LOCAL_MODEL_CODING_TASK_ID } from "./local-model-coding-proof-contract";

const runHistoryHandoff = {
  schema_version: "vera_builder_loop_placeholder_module_card_v1" as const,
  source: "veralux-system" as const,
  requested_by: "operator",
  artifact_type: "placeholder_module_card" as const,
  execution_mode: "metadata_only" as const,
  integration_mode: "blocked_manual_only" as const,
  final_integration_authorized: false as const,
  repo_mutation_authorized: false as const,
  branch_creation_authorized: false as const,
  commit_creation_authorized: false as const,
  pr_creation_authorized: false as const,
  deploy_authorized: false as const,
  merge_authorized: false as const,
  arbitrary_execution_authorized: false as const,
  arbitrary_filesystem_path_authorized: false as const,
  system_source_of_truth: true,
  console_metadata_authoritative: false,
  builder_loop_mode: "code_in_sandbox" as const,
  coding_task_id: "builder_loop_run_history_v1",
  coding_task: {
    task_kind: "custom_bounded_code_task_v1" as const,
    coding_task_id: "builder_loop_run_history_v1",
    task_title: "Builder Loop Run History V1",
    requested_change: "Build run history",
    target_area: "src/services/vera/vera-builder-loop-run-history",
    acceptance_criteria: ["Lists prior requests"],
    expected_files: [
      "src/services/vera/vera-builder-loop-run-history.ts",
      "src/services/vera/vera-builder-loop-run-history.test.ts",
    ],
    allowed_file_patterns: [
      "src/services/vera/vera-builder-loop-run-history.ts",
      "src/services/vera/vera-builder-loop-run-history.test.ts",
    ],
    blocked_file_patterns: ["../**", "node_modules/**", ".env*", "package.json"],
    test_expectations: [
      "npm test -- --run src/services/vera/vera-builder-loop-run-history.test.ts",
    ],
    constraints: ["Isolated only"],
    integration_intent: "candidate_only" as const,
  },
  request: {
    module_card_name: "Builder Loop Run History V1",
    purpose: "Track requests",
    scope: [],
    constraints: [],
    risks: [],
    acceptance_criteria: [],
    requested_artifact_type: "placeholder_module_card" as const,
    integration_status: "blocked_manual_only" as const,
  },
};

describe("generated file validation", () => {
  it("accepts exact allowed Run History paths", () => {
    const taskSpec = resolveCodingTaskSpec(runHistoryHandoff);
    const result = validateGeneratedFilesForTask([
      {
        relativePath: "src/services/vera/vera-builder-loop-run-history.ts",
        content: "export function listBuilderLoopRunHistory() { return []; }",
      },
      {
        relativePath: "src/services/vera/vera-builder-loop-run-history.test.ts",
        content: "import { describe, expect, it } from \"vitest\";",
      },
    ], taskSpec, runHistoryHandoff);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(2);
      expect(result.allowed_paths).toEqual(runHistoryHandoff.coding_task.expected_files);
    }
  });

  it("rejects absolute and traversal paths", () => {
    const taskSpec = resolveCodingTaskSpec(runHistoryHandoff);
    for (const relativePath of ["/tmp/evil.ts", "../outside.ts", "..."]) {
      const result = validateGeneratedFilesForTask([
        { relativePath, content: "bad" },
      ], taskSpec, runHistoryHandoff);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejected_paths).toContain(relativePath);
        expect(result.allowed_paths.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects extra generated files outside expected_files", () => {
    const taskSpec = resolveCodingTaskSpec(runHistoryHandoff);
    const result = validateGeneratedFilesForTask([
      {
        relativePath: "src/services/vera/vera-builder-loop-run-history.ts",
        content: "export function listBuilderLoopRunHistory() { return []; }",
      },
      {
        relativePath: "src/services/vera/extra-file.ts",
        content: "export const extra = true;",
      },
    ], taskSpec, runHistoryHandoff);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected_paths).toContain("src/services/vera/extra-file.ts");
    }
  });

  it("lists allowed paths for legacy canary task", () => {
    const handoff = {
      ...runHistoryHandoff,
      coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
      coding_task: undefined,
    };
    const taskSpec = resolveCodingTaskSpec(handoff);
    expect(listAllowedPathsForTask(handoff, taskSpec)).toEqual([
      "src/formatBuilderLoopDecisionLabel.js",
      "src/formatBuilderLoopDecisionLabel.test.js",
    ]);
  });
});
