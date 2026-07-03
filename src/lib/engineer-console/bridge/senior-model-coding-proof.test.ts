import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  VERA_LOCAL_MODEL_CODING_TASK_ID,
} from "./local-model-coding-proof-contract";
import {
  RUN_HISTORY_V1_SERVICE_PATH,
  RUN_HISTORY_V1_TEST_PATH,
} from "./local-model-coding-scaffold";
import { runVeraSeniorModelCodingProof } from "./senior-model-coding-proof";
import {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-senior-model-coding-test-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function baseHandoff(
  overrides: Partial<VeraPlaceholderModuleCardHandoff> = {},
): VeraPlaceholderModuleCardHandoff {
  return {
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
    coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
    request: {
      module_card_name: "Local Model Coding Proof",
      purpose: "Prove local model can generate tested code in isolation.",
      scope: ["Generate formatBuilderLoopDecisionLabel with tests."],
      constraints: ["Isolated workspace only."],
      risks: ["Model output may be invalid."],
      acceptance_criteria: ["Tests pass in isolated workspace."],
      requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    },
    ...overrides,
  };
}

function runHistoryHandoff() {
  return {
    ...baseHandoff({
      builder_loop_mode: "code_in_sandbox",
      coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
      code_source_repo_root: path.resolve(process.cwd(), "..", "Veralux-System"),
      coding_task: {
        task_kind: "custom_bounded_code_task_v1" as const,
        coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
        task_title: "Builder Loop Run History V1",
        requested_change: "Build run history",
        target_area: "src/services/vera/vera-builder-loop-run-history",
        acceptance_criteria: ["Lists prior requests"],
        orchestration_mode: "scaffold_first" as const,
        model_editable_files: [RUN_HISTORY_V1_SERVICE_PATH],
        expected_files: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
        allowed_file_patterns: [RUN_HISTORY_V1_SERVICE_PATH, RUN_HISTORY_V1_TEST_PATH],
        blocked_file_patterns: ["../**", "node_modules/**", ".env*", "package.json"],
        test_expectations: [`npm test -- --run ${RUN_HISTORY_V1_TEST_PATH}`],
        constraints: ["Isolated only"],
        integration_intent: "candidate_only" as const,
      },
    }),
    builder_loop_mode: "code_in_sandbox" as const,
    coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  };
}

const mockRunHistoryImplementation = `import fs from "node:fs";
import path from "node:path";

export type BuilderLoopRunHistoryStage =
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

const STAGE_DIRECTORIES: Array<{ stage: BuilderLoopRunHistoryStage; dir: string }> = [
  { stage: "manual_integration_candidate", dir: "builder-loop-manual-integration-candidates" },
  { stage: "controlled_apply_dry_run", dir: "builder-loop-controlled-apply-dry-runs" },
  { stage: "controlled_apply_sandbox", dir: "builder-loop-controlled-apply-sandboxes" },
  { stage: "controlled_apply_approval_decision", dir: "builder-loop-controlled-apply-approval-decisions" },
  { stage: "real_controlled_apply", dir: "builder-loop-controlled-apply-records" },
];

export async function loadBuilderLoopRunHistory(input: {
  workspaceRoot: string;
}): Promise<BuilderLoopRunHistoryResult> {
  const warnings: string[] = [];
  const items: BuilderLoopRunHistoryItem[] = [];

  for (const { stage, dir } of STAGE_DIRECTORIES) {
    const dirPath = path.join(input.workspaceRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const filename of fs.readdirSync(dirPath)) {
      if (!filename.endsWith(".json")) continue;
      const source_file = path.join(dir, filename);
      const fullPath = path.join(dirPath, filename);
      try {
        const record = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Record<string, unknown>;
        items.push({
          stage,
          status: typeof record.integration_state === "string"
            ? record.integration_state
            : typeof record.status === "string"
              ? record.status
              : "unknown",
          created_at: typeof record.created_at === "string" ? record.created_at : undefined,
          evidence_id: typeof record.evidence_id === "string" ? record.evidence_id : undefined,
          candidate_id: typeof record.candidate_id === "string" ? record.candidate_id : undefined,
          model_used: typeof record.model_used === "string" ? record.model_used : undefined,
          repair_attempts: typeof record.repair_attempts === "number" ? record.repair_attempts : undefined,
          files_changed: Array.isArray(record.files_changed)
            ? record.files_changed.filter((item): item is string => typeof item === "string")
            : undefined,
          test_result: typeof record.test_result === "string"
            ? record.test_result
            : typeof record.test_passed === "boolean"
              ? String(record.test_passed)
              : undefined,
          integration_state: typeof record.integration_state === "string" ? record.integration_state : undefined,
          boundary_flags: typeof record.boundary_flags === "object" && record.boundary_flags !== null
            ? Object.fromEntries(
              Object.entries(record.boundary_flags).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
            )
            : undefined,
          next_action: typeof record.next_action === "string" ? record.next_action : undefined,
          source_file,
        });
      } catch {
        warnings.push(\`Failed to parse \${source_file}\`);
      }
    }
  }

  return { items, warnings, total_records: items.length };
}
`;

async function mockSeniorGenerateRunHistoryCode() {
  return {
    modelUsed: "qwen-coder-32b-mock",
    endpoint: "http://127.0.0.1:8080/v1/chat/completions",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify({
      files: [{ relativePath: RUN_HISTORY_V1_SERVICE_PATH, content: mockRunHistoryImplementation }],
    }),
    files: [{ relativePath: RUN_HISTORY_V1_SERVICE_PATH, content: mockRunHistoryImplementation }],
    promptSummary: "Injected senior scaffold-first Run History implementation.",
  };
}

describe("Vera senior model coding proof", () => {
  it("reports senior model not configured when senior env is absent", async () => {
    const result = await runVeraSeniorModelCodingProof(runHistoryHandoff(), {
      tempRoot,
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("senior_model_not_configured");
    expect(result.execution_mode).toBe("senior_model_scaffold_retry");
  });

  it("rejects non-scaffold-first custom tasks", async () => {
    const result = await runVeraSeniorModelCodingProof(baseHandoff({
      coding_task_id: "custom_unbounded_v1",
      coding_task: {
        task_kind: "custom_bounded_code_task_v1",
        coding_task_id: "custom_unbounded_v1",
        task_title: "Custom task",
        requested_change: "Build utility",
        target_area: "src/services/vera/custom.ts",
        acceptance_criteria: ["Tests pass"],
        allowed_file_patterns: ["src/services/vera/custom.ts"],
        blocked_file_patterns: [],
        test_expectations: ["npm test -- --run src/services/vera/custom.ts"],
        constraints: [],
        integration_intent: "candidate_only",
        orchestration_mode: "full_generation",
      },
    }), { tempRoot });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.execution_mode).toBe("senior_model_scaffold_retry");
  });

  it("rejects senior config that collides with the local default worker", async () => {
    const result = await runVeraSeniorModelCodingProof(runHistoryHandoff(), {
      tempRoot,
      env: {
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "Nemotron-Nano-30B-A3B-NVFP4",
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED: "true",
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL: "Nemotron-Nano-30B-A3B-NVFP4",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.errors[0]).toContain("collides with local default worker");
  });

  it("runs scaffold-first senior proof in isolated workspace with distinct Qwen mock metadata", async () => {
    const systemRepoRoot = path.resolve(process.cwd(), "..", "Veralux-System");
    if (!fs.existsSync(path.join(systemRepoRoot, "node_modules", "vitest", "vitest.mjs"))) {
      return;
    }

    const result = await runVeraSeniorModelCodingProof(runHistoryHandoff(), {
      tempRoot,
      workspaceId: () => "senior-coding-proof",
      generateCode: mockSeniorGenerateRunHistoryCode,
      env: {
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:8080/v1",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "qwen-coder-32b-mock",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("senior_model_coding_proof_passed");
    expect(result.execution_mode).toBe("senior_model_scaffold_retry");
    expect(result.model?.model_used).toBe("qwen-coder-32b-mock");
    expect(result.model?.endpoint).toContain("8080");
    expect(result.evidence?.evidence_id).toMatch(/^senior-model-coding-proof-/);
    expect(result.patch?.files_created_or_changed).toContain(RUN_HISTORY_V1_SERVICE_PATH);
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
    expect(result.boundary_flags.final_integration_authorized).toBe(false);
  });
});
