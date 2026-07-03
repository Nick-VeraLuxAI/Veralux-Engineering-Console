import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseGeneratedCodingFiles,
  tryParseGeneratedCodingFiles,
} from "./local-openai-compatible-coding-client";
import {
  VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION,
  VERA_LOCAL_MODEL_CODING_TASK_ID,
  VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  validateVeraLocalModelCodingProofHandoff,
} from "./local-model-coding-proof-contract";
import {
  RUN_HISTORY_V1_SERVICE_PATH,
  RUN_HISTORY_V1_TEST_PATH,
} from "./local-model-coding-scaffold";
import {
  runVeraLocalModelCodingProof,
} from "./local-model-coding-proof";
import {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-local-model-coding-test-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function handoff(overrides: Partial<VeraPlaceholderModuleCardHandoff> = {}): VeraPlaceholderModuleCardHandoff & {
  coding_task_id: typeof VERA_LOCAL_MODEL_CODING_TASK_ID;
} {
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

const mockGeneratedFiles = {
  files: [
    {
      relativePath: "src/formatBuilderLoopDecisionLabel.js",
      content: `export function formatBuilderLoopDecisionLabel(input) {
  switch (input) {
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    case "request_changes":
      return "Changes requested";
    default:
      return "Unknown decision";
  }
}
`,
    },
    {
      relativePath: "src/formatBuilderLoopDecisionLabel.test.js",
      content: `import test from "node:test";
import assert from "node:assert/strict";
import { formatBuilderLoopDecisionLabel } from "./formatBuilderLoopDecisionLabel.js";

test("maps approve", () => {
  assert.equal(formatBuilderLoopDecisionLabel("approve"), "Approved");
});
test("maps reject", () => {
  assert.equal(formatBuilderLoopDecisionLabel("reject"), "Rejected");
});
test("maps request_changes", () => {
  assert.equal(formatBuilderLoopDecisionLabel("request_changes"), "Changes requested");
});
test("maps unknown", () => {
  assert.equal(formatBuilderLoopDecisionLabel("other"), "Unknown decision");
});
`,
    },
  ],
};

const mockBadAssertGeneratedFiles = {
  files: [
    mockGeneratedFiles.files[0],
    {
      relativePath: "src/formatBuilderLoopDecisionLabel.test.js",
      content: `import { test, assert } from "node:test";
import { formatBuilderLoopDecisionLabel } from "./formatBuilderLoopDecisionLabel.js";

test("maps approve", () => {
  assert.strictEqual(formatBuilderLoopDecisionLabel("approve"), "Approved");
});
test("maps reject", () => {
  assert.strictEqual(formatBuilderLoopDecisionLabel("reject"), "Rejected");
});
test("maps request_changes", () => {
  assert.strictEqual(formatBuilderLoopDecisionLabel("request_changes"), "Changes requested");
});
test("maps unknown", () => {
  assert.strictEqual(formatBuilderLoopDecisionLabel("other"), "Unknown decision");
});
`,
    },
  ],
};

async function mockGenerateCode() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify(mockGeneratedFiles),
    files: mockGeneratedFiles.files,
    promptSummary: "Injected test provider response for formatBuilderLoopDecisionLabel.",
  };
}

async function mockGenerateBadAssertCode() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify(mockBadAssertGeneratedFiles),
    files: mockBadAssertGeneratedFiles.files,
    promptSummary: "Injected bad assert import for repair testing.",
  };
}

async function mockGenerateRepair() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model-repair",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify(mockGeneratedFiles),
    files: mockGeneratedFiles.files,
    promptSummary: "Repair isolated coding proof files after test failure (attempt 1).",
  };
}

async function mockGenerateRepairStillBad() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model-repair",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify(mockBadAssertGeneratedFiles),
    files: mockBadAssertGeneratedFiles.files,
    promptSummary: "Repair attempt still failing.",
  };
}

async function mockGenerateInvalidPathCode() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify({
      files: [{ relativePath: "...", content: "placeholder" }],
    }),
    files: [{ relativePath: "...", content: "placeholder" }],
    promptSummary: "Injected invalid path placeholder output.",
  };
}

async function mockGenerateOutputValidationRepair(context: {
  repairReason?: string;
  attemptNumber: number;
}) {
  if (context.repairReason === "output_validation" || context.repairReason === "parse_failure") {
    return mockGenerateCode();
  }
  return mockGenerateRepair();
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

const mockRunHistoryGeneratedFiles = {
  files: [
    {
      relativePath: RUN_HISTORY_V1_SERVICE_PATH,
      content: mockRunHistoryImplementation,
    },
  ],
};

function runHistoryHandoff() {
  return {
    ...handoff({
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
        test_expectations: [
          `npm test -- --run ${RUN_HISTORY_V1_TEST_PATH}`,
        ],
        constraints: ["Isolated only"],
        integration_intent: "candidate_only" as const,
      },
    }),
    builder_loop_mode: "code_in_sandbox" as const,
    coding_task_id: VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  };
}

async function mockGenerateRunHistoryCode() {
  return {
    modelUsed: "mock-local-model-v1",
    endpoint: "test://injected-local-model",
    modelGenerationReal: false as const,
    rawContent: JSON.stringify(mockRunHistoryGeneratedFiles),
    files: mockRunHistoryGeneratedFiles.files,
    promptSummary: "Injected scaffold-first Run History implementation.",
  };
}

describe("Vera local model coding proof", () => {
  it("validates coding proof handoff requires coding_task_id", () => {
    const result = validateVeraLocalModelCodingProofHandoff(handoff());
    expect(result.ok).toBe(true);
    const rejected = validateVeraLocalModelCodingProofHandoff({
      ...handoff(),
      coding_task_id: "wrong-task",
    });
    expect(rejected.ok).toBe(false);
  });

  it("reports local model not configured when enabled flag is absent", async () => {
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("local_model_not_configured");
    expect(result.boundary_flags.model_generation_real).toBe(false);
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
  });

  it("creates real code in isolated workspace, runs tests, and returns patch/evidence with model metadata", async () => {
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof",
      generateCode: mockGenerateCode,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("local_model_coding_proof_passed");
    expect(result.schema_version).toBe(VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION);
    expect(result.model?.model_used).toBe("mock-local-model-v1");
    expect(result.model?.model_generation_real).toBe(false);
    expect(result.model?.prompt_summary).toContain("formatBuilderLoopDecisionLabel");
    expect(result.patch?.files_created_or_changed).toEqual([
      "src/formatBuilderLoopDecisionLabel.js",
      "src/formatBuilderLoopDecisionLabel.test.js",
    ]);
    expect(result.patch?.unified_diff).toContain("formatBuilderLoopDecisionLabel");
    expect(result.tests?.passed).toBe(true);
    expect(result.repair_loop?.repair_attempts_count).toBe(0);
    expect(result.repair_loop?.repair_required).toBe(false);
    expect(result.repair_loop?.final_status).toBe("passed");
    expect(result.tests?.command_executable).toBe("node");
    expect(result.evidence?.workspace_retention).toBe("cleaned_up");
    expect(result.evidence?.workspace_exists_after_cleanup).toBe(false);
    expect(result.evidence?.checks_run.every((check) => check.status === "passed")).toBe(true);
    expect(result.boundary_flags.branch_creation_authorized).toBe(false);
    expect(result.boundary_flags.commit_creation_authorized).toBe(false);
    expect(result.boundary_flags.pr_creation_authorized).toBe(false);
    expect(result.boundary_flags.deploy_authorized).toBe(false);
    expect(result.boundary_flags.merge_authorized).toBe(false);
    expect(result.boundary_flags.final_integration_authorized).toBe(false);
    expect(result.boundary_flags.production_data_used).toBe(false);

    const workspaces = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("vera-builder-loop-coding-"));
    expect(workspaces).toHaveLength(0);
  });

  it("rejects authority escalation and unsafe generated paths", async () => {
    const rejected = await runVeraLocalModelCodingProof({
      ...handoff(),
      final_integration_authorized: true,
    }, { tempRoot, generateCode: mockGenerateCode });
    expect(rejected.ok).toBe(false);
    expect(rejected.status).toBe("rejected");

    expect(() => parseGeneratedCodingFiles(JSON.stringify({
      files: [{ relativePath: "../outside.js", content: "bad" }],
    }))).toThrow(/Unsafe generated path/);

    const placeholderPath = tryParseGeneratedCodingFiles(JSON.stringify({
      files: [{ relativePath: "...", content: "bad" }],
    }));
    expect(placeholderPath.ok).toBe(false);
    if (!placeholderPath.ok) {
      expect(placeholderPath.rejected_paths).toContain("...");
    }

    const nemotronStyle = `We need to create two files for the coding proof.
</think>
{"files":[{"relativePath":"src/formatBuilderLoopDecisionLabel.js","content":"export function formatBuilderLoopDecisionLabel(input){return input;}"}]}`;
    const parsed = parseGeneratedCodingFiles(nemotronStyle);
    expect(parsed[0]?.relativePath).toBe("src/formatBuilderLoopDecisionLabel.js");
    expect(parsed[0]?.content).toContain("export function formatBuilderLoopDecisionLabel");

    const escapedNewlines = `{"files":[{"relativePath":"src/a.js","content":"line1\\\\nline2"}]}`;
    expect(parseGeneratedCodingFiles(escapedNewlines)[0]?.content).toBe("line1\nline2");

    const markdownFence = `\`\`\`ts
// src/services/vera/vera-builder-loop-run-history.ts
export function listBuilderLoopRunHistory() { return []; }
\`\`\`
\`\`\`ts
// src/services/vera/vera-builder-loop-run-history.test.ts
import { describe, expect, it } from "vitest";
\`\`\``;
    const fenceParsed = parseGeneratedCodingFiles(markdownFence);
    expect(fenceParsed).toHaveLength(2);
    expect(fenceParsed[0]?.relativePath).toBe("src/services/vera/vera-builder-loop-run-history.ts");
  });

  it("does not invoke repair when initial tests pass", async () => {
    const generateRepair = vi.fn(async () => mockGenerateRepair());
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-pass",
      generateCode: mockGenerateCode,
      generateRepair,
    });

    expect(result.ok).toBe(true);
    expect(result.repair_loop?.repair_attempts_count).toBe(0);
    expect(result.repair_loop?.total_attempts).toBe(1);
    expect(generateRepair).not.toHaveBeenCalled();
  });

  it("invokes bounded repair when initial tests fail and can pass after repair", async () => {
    const generateRepair = vi.fn(async () => mockGenerateRepair());
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-repair",
      generateCode: mockGenerateBadAssertCode,
      generateRepair,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("local_model_coding_proof_passed");
    expect(result.repair_loop?.initial_status).toBe("failed");
    expect(result.repair_loop?.final_status).toBe("passed");
    expect(result.repair_loop?.repair_required).toBe(true);
    expect(result.repair_loop?.repair_attempts_count).toBe(1);
    expect(result.repair_loop?.total_attempts).toBe(2);
    expect(result.model?.repair_prompt_summary).toContain("Repair isolated coding proof");
    expect(generateRepair).toHaveBeenCalledTimes(1);
    expect(result.tests?.passed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("Repair was required"))).toBe(true);
  });

  it("returns failure evidence when bounded repair cannot fix tests", async () => {
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-repair-fail",
      maxRepairAttempts: 2,
      generateCode: mockGenerateBadAssertCode,
      generateRepair: mockGenerateRepairStillBad,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.repair_loop?.repair_attempts_count).toBe(2);
    expect(result.repair_loop?.total_attempts).toBe(3);
    expect(result.repair_loop?.final_status).toBe("failed");
    expect(result.tests?.passed).toBe(false);
    expect(result.evidence?.summary).toContain("bounded repair");
  });

  it("keeps repair writes inside the isolated workspace and blocks repo mutation", async () => {
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-contained",
      cleanup: false,
      generateCode: mockGenerateBadAssertCode,
      generateRepair: mockGenerateRepair,
    });

    const workspaceDir = fs.readdirSync(tempRoot).find((entry) => entry.startsWith("vera-builder-loop-coding-"));
    expect(workspaceDir).toBeTruthy();
    const workspacePath = path.join(tempRoot, workspaceDir!);
    expect(fs.existsSync(path.join(workspacePath, "src/formatBuilderLoopDecisionLabel.test.js"))).toBe(true);
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
    expect(result.boundary_flags.branch_creation_authorized).toBe(false);
    expect(result.boundary_flags.commit_creation_authorized).toBe(false);
    expect(result.boundary_flags.pr_creation_authorized).toBe(false);
    expect(result.boundary_flags.deploy_authorized).toBe(false);
    expect(result.boundary_flags.merge_authorized).toBe(false);
    expect(result.boundary_flags.final_integration_authorized).toBe(false);
  });

  it("routes invalid generated paths through bounded output validation repair", async () => {
    const generateRepair = vi.fn(async (context) => mockGenerateOutputValidationRepair(context));
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-output-repair",
      generateCode: mockGenerateInvalidPathCode,
      generateRepair,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("local_model_coding_proof_passed");
    expect(result.output_validation?.repair_attempted).toBe(true);
    expect(result.output_validation?.final_paths_valid).toBe(true);
    expect(result.output_validation?.allowed_paths).toEqual([
      "src/formatBuilderLoopDecisionLabel.js",
      "src/formatBuilderLoopDecisionLabel.test.js",
    ]);
    expect(generateRepair).toHaveBeenCalledTimes(1);
    expect(generateRepair.mock.calls[0]?.[0]?.repairReason).toBe("output_validation");
    expect(result.repair_loop?.repair_attempts_count).toBe(1);
  });

  it("fails with output validation evidence when repair still returns unsafe paths", async () => {
    const result = await runVeraLocalModelCodingProof(handoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-output-repair-fail",
      maxRepairAttempts: 1,
      generateCode: mockGenerateInvalidPathCode,
      generateRepair: mockGenerateInvalidPathCode,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("local_model_unavailable");
    expect(result.output_validation?.repair_attempted).toBe(true);
    expect(result.output_validation?.final_paths_valid).toBe(false);
    expect(result.output_validation?.rejected_paths).toContain("...");
    expect(result.errors.some((error) => error.includes("Unsafe generated path"))).toBe(true);
    expect(result.evidence?.summary).toContain("invalid model output paths/format");
  });

  it("seeds preset scaffold and passes vitest when model generates only Run History implementation", async () => {
    const systemRepoRoot = path.resolve(process.cwd(), "..", "Veralux-System");
    if (!fs.existsSync(path.join(systemRepoRoot, "node_modules", "vitest", "vitest.mjs"))) {
      return;
    }

    const result = await runVeraLocalModelCodingProof(runHistoryHandoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-run-history-scaffold",
      generateCode: mockGenerateRunHistoryCode,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("local_model_coding_proof_passed");
    expect(result.tests?.passed).toBe(true);
    expect(result.patch?.files_created_or_changed).toEqual([
      RUN_HISTORY_V1_TEST_PATH,
      RUN_HISTORY_V1_SERVICE_PATH,
    ]);
    expect(result.output_validation?.allowed_paths).toEqual([RUN_HISTORY_V1_SERVICE_PATH]);
    expect(result.warnings.some((warning) => warning.includes("Scaffold-first"))).toBe(true);
    expect(result.repair_loop?.repair_attempts_count).toBe(0);
  });

  it("rejects scaffold-first model output that attempts to rewrite the preset test file", async () => {
    const generateRepair = vi.fn(async () => mockGenerateRunHistoryCode());
    const result = await runVeraLocalModelCodingProof(runHistoryHandoff(), {
      tempRoot,
      workspaceId: () => "coding-proof-run-history-scaffold-reject",
      maxRepairAttempts: 1,
      generateCode: async () => ({
        modelUsed: "mock-local-model-v1",
        endpoint: "test://injected-local-model",
        modelGenerationReal: false as const,
        rawContent: JSON.stringify({
          files: [
            { relativePath: RUN_HISTORY_V1_SERVICE_PATH, content: mockRunHistoryImplementation },
            { relativePath: RUN_HISTORY_V1_TEST_PATH, content: "export const bad = true;" },
          ],
        }),
        files: [
          { relativePath: RUN_HISTORY_V1_SERVICE_PATH, content: mockRunHistoryImplementation },
          { relativePath: RUN_HISTORY_V1_TEST_PATH, content: "export const bad = true;" },
        ],
        promptSummary: "Invalid scaffold rewrite attempt.",
      }),
      generateRepair,
    });

    expect(result.ok).toBe(true);
    expect(generateRepair).toHaveBeenCalledTimes(1);
    expect(generateRepair.mock.calls[0]?.[0]?.repairReason).toBe("output_validation");
    expect(result.output_validation?.final_paths_valid).toBe(true);
    expect(result.tests?.passed).toBe(true);
  });
});
