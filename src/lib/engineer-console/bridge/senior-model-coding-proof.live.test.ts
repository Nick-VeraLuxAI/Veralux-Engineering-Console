import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID } from "./local-model-coding-proof-contract";
import { RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH } from "./local-model-coding-scaffold";
import { runVeraSeniorModelCodingProof } from "./senior-model-coding-proof";
import {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
} from "./placeholder-module-card-contract";

const LIVE = process.env.CONSOLE_LIVE_SENIOR_CODING_PROOF === "1";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-senior-live-proof-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe.skipIf(!LIVE)("Vera senior model coding proof live", () => {
  it("runs scaffold-first Run History proof against configured senior Qwen endpoint", async () => {
    const handoff = {
      schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
      source: "veralux-system",
      requested_by: "operator",
      artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
      integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
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
      code_source_repo_root: path.resolve(process.cwd(), "..", "Veralux-System"),
      coding_task: {
        task_kind: "custom_bounded_code_task_v1",
        coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
        task_title: "Builder Loop Run History V1",
        requested_change: "Build run history service",
        target_area: "src/services/vera/vera-builder-loop-run-history",
        acceptance_criteria: ["Lists prior requests"],
        orchestration_mode: "scaffold_first",
        model_editable_files: [RUN_HISTORY_V1_SERVICE_PATH],
        expected_files: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
        allowed_file_patterns: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
        blocked_file_patterns: ["../**", "node_modules/**", ".env*", "package.json"],
        test_expectations: [`npm test -- --run ${RUN_HISTORY_V1_TEST_PATH}`],
        constraints: ["Isolated only"],
        integration_intent: "candidate_only",
      },
      request: {
        module_card_name: "Builder Loop Run History V1",
        purpose: "Senior scaffold retry live proof",
        scope: ["Implement run history service"],
        constraints: ["Isolated only"],
        risks: ["Model may fail"],
        acceptance_criteria: ["Vitest passes"],
        requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
        integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
      },
    };

    const result = await runVeraSeniorModelCodingProof(handoff, {
      tempRoot,
      cleanup: true,
      env: process.env,
    });

    expect(result.execution_mode).toBe("senior_model_scaffold_retry");
    expect(result.model?.endpoint).toContain("8080");
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
    expect(["senior_model_coding_proof_passed", "senior_model_coding_proof_failed", "senior_model_unavailable"]).toContain(result.status);
  }, 600_000);
});
