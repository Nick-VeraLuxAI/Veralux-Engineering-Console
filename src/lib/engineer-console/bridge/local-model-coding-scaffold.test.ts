import { describe, expect, it } from "vitest";
import {
  resolvePresetScaffoldFiles,
  resolveScaffoldFilesForTask,
  RUN_HISTORY_V1_SERVICE_PATH,
  RUN_HISTORY_V1_TEST_PATH,
} from "./local-model-coding-scaffold";
import { VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID } from "./local-model-coding-proof-contract";

describe("local model coding scaffold", () => {
  it("provides a preset vitest scaffold for Run History V1", () => {
    const files = resolvePresetScaffoldFiles(VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID);
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe(RUN_HISTORY_V1_TEST_PATH);
    expect(files[0]?.content).toContain("loadBuilderLoopRunHistory");
    expect(files[0]?.content).toContain("mkdtempSync");
  });

  it("resolves scaffold-first task files from orchestration mode", () => {
    const files = resolveScaffoldFilesForTask({
      task_kind: "custom_bounded_code_task_v1",
      coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
      task_title: "Builder Loop Run History V1",
      requested_change: "Build run history",
      target_area: "src/services/vera/vera-builder-loop-run-history",
      acceptance_criteria: [],
      expected_files: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
      allowed_file_patterns: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
      blocked_file_patterns: [],
      test_expectations: ["npm test -- --run src/services/vera/vera-builder-loop-run-history.test.ts"],
      constraints: [],
      integration_intent: "candidate_only",
      orchestration_mode: "scaffold_first",
      model_editable_files: [RUN_HISTORY_V1_SERVICE_PATH],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe(RUN_HISTORY_V1_TEST_PATH);
  });
});
