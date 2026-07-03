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
  validateVeraLocalModelCodingProofHandoff,
} from "./local-model-coding-proof-contract";
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
});
