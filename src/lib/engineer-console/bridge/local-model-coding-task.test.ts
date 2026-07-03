import { describe, expect, it } from "vitest";
import {
  inferRunHistoryRepairGuidance,
  pathMatchesPattern,
  resolveCodingTaskSpec,
} from "./local-model-coding-task";
import {
  VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  VERA_LOCAL_MODEL_CODING_TASK_ID,
} from "./local-model-coding-proof-contract";

describe("local model coding task resolver", () => {
  it("matches exact and glob allowed file patterns", () => {
    expect(pathMatchesPattern("src/services/vera/foo.ts", "src/services/vera/foo.ts")).toBe(true);
    expect(pathMatchesPattern("src/services/vera/foo.ts", "src/**/foo.ts")).toBe(true);
    expect(pathMatchesPattern("../outside.ts", "src/**")).toBe(false);
  });

  it("resolves legacy decision label task without coding_task payload", () => {
    const spec = resolveCodingTaskSpec({
      schema_version: "vera_builder_loop_placeholder_module_card_v1",
      source: "veralux-system",
      requested_by: "operator",
      artifact_type: "placeholder_module_card",
      execution_mode: "metadata_only",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      system_source_of_truth: true,
      console_metadata_authoritative: false,
      coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
      request: {
        module_card_name: "Canary",
        purpose: "Canary",
        scope: [],
        constraints: [],
        risks: [],
        acceptance_criteria: [],
        requested_artifact_type: "placeholder_module_card",
        integration_status: "blocked_manual_only",
      },
    });

    expect(spec.taskId).toBe(VERA_LOCAL_MODEL_CODING_TASK_ID);
    expect(spec.testCommand.label).toContain("node --test");
  });

  it("resolves custom bounded Run History task with vitest command", () => {
    const spec = resolveCodingTaskSpec({
      schema_version: "vera_builder_loop_placeholder_module_card_v1",
      source: "veralux-system",
      requested_by: "operator",
      artifact_type: "placeholder_module_card",
      execution_mode: "metadata_only",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      system_source_of_truth: true,
      console_metadata_authoritative: false,
      builder_loop_mode: "code_in_sandbox",
      coding_task_id: "builder_loop_run_history_v1",
      code_source_repo_root: "/tmp/veralux-system",
      coding_task: {
        task_kind: "custom_bounded_code_task_v1",
        coding_task_id: "builder_loop_run_history_v1",
        task_title: "Builder Loop Run History V1",
        requested_change: "Build run history",
        target_area: "src/services/vera/vera-builder-loop-run-history",
        acceptance_criteria: ["Lists prior requests"],
        orchestration_mode: "scaffold_first",
        model_editable_files: [
          "src/services/vera/vera-builder-loop-run-history.ts",
        ],
        expected_files: [
          "src/services/vera/vera-builder-loop-run-history.ts",
          "src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        allowed_file_patterns: [
          "src/services/vera/vera-builder-loop-run-history.ts",
          "src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        blocked_file_patterns: ["../**"],
        test_expectations: [
          "npm test -- --run src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        constraints: ["Isolated only"],
        integration_intent: "candidate_only",
      },
      request: {
        module_card_name: "Builder Loop Run History V1",
        purpose: "Track requests",
        scope: [],
        constraints: [],
        risks: [],
        acceptance_criteria: [],
        requested_artifact_type: "placeholder_module_card",
        integration_status: "blocked_manual_only",
      },
    });

    expect(spec.taskId).toBe("builder_loop_run_history_v1");
    expect(spec.orchestrationMode).toBe("scaffold_first");
    expect(spec.modelEditableRelativePaths.has("src/services/vera/vera-builder-loop-run-history.ts")).toBe(true);
    expect(spec.scaffoldedRelativePaths.has("src/services/vera/vera-builder-loop-run-history.test.ts")).toBe(true);
    expect(spec.scaffoldFiles).toHaveLength(1);
    expect(spec.testCommand.label).toContain("npm test -- --run");
    const generation = spec.buildGenerationRequest();
    expect(generation.userPrompt).toContain("deterministic vitest scaffold");
    expect(generation.userPrompt).toContain("loadBuilderLoopRunHistory");
  });

  it("infers repair guidance for logger and placeholder failures", () => {
    const guidance = inferRunHistoryRepairGuidance("", "TypeError: log.warn is not a function");
    expect(guidance.some((item) => item.includes("Remove log"))).toBe(true);

    const placeholderGuidance = inferRunHistoryRepairGuidance("", 'ERROR: Unexpected "..."');
    expect(placeholderGuidance.some((item) => item.includes("placeholder"))).toBe(true);
  });

  it("uses Run History-specific repair prompt for builder_loop_run_history_v1", () => {
    const spec = resolveCodingTaskSpec({
      schema_version: "vera_builder_loop_placeholder_module_card_v1",
      source: "veralux-system",
      requested_by: "operator",
      artifact_type: "placeholder_module_card",
      execution_mode: "metadata_only",
      integration_mode: "blocked_manual_only",
      final_integration_authorized: false,
      repo_mutation_authorized: false,
      branch_creation_authorized: false,
      commit_creation_authorized: false,
      pr_creation_authorized: false,
      deploy_authorized: false,
      merge_authorized: false,
      arbitrary_execution_authorized: false,
      arbitrary_filesystem_path_authorized: false,
      system_source_of_truth: true,
      console_metadata_authoritative: false,
      builder_loop_mode: "code_in_sandbox",
      coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
      coding_task: {
        task_kind: "custom_bounded_code_task_v1",
        coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
        task_title: "Builder Loop Run History V1",
        requested_change: "Build run history",
        target_area: "src/services/vera/vera-builder-loop-run-history",
        acceptance_criteria: ["Lists prior requests"],
        orchestration_mode: "scaffold_first",
        model_editable_files: [
          "src/services/vera/vera-builder-loop-run-history.ts",
        ],
        expected_files: [
          "src/services/vera/vera-builder-loop-run-history.ts",
          "src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        allowed_file_patterns: [
          "src/services/vera/vera-builder-loop-run-history.ts",
          "src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        blocked_file_patterns: ["../**"],
        test_expectations: [
          "npm test -- --run src/services/vera/vera-builder-loop-run-history.test.ts",
        ],
        constraints: ["Isolated only"],
        integration_intent: "candidate_only",
      },
      request: {
        module_card_name: "Builder Loop Run History V1",
        purpose: "Track requests",
        scope: [],
        constraints: [],
        risks: [],
        acceptance_criteria: [],
        requested_artifact_type: "placeholder_module_card",
        integration_status: "blocked_manual_only",
      },
    });

    const repair = spec.buildRepairRequest({
      attemptNumber: 1,
      testCommand: "npm test -- --run src/services/vera/vera-builder-loop-run-history.test.ts",
      testStdout: "",
      testStderr: "TypeError: log.warn is not a function",
      currentFiles: [],
      repairReason: "test_failure",
    });
    expect(repair.userPrompt).toContain("Repair guidance");
    expect(repair.userPrompt).toContain("Remove log");
  });
});
