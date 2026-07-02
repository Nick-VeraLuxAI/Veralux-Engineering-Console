import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBoundedCommand } from "@/lib/engineer-console/hermes-worker/hermes-bounded-command-runner";
import { getLocalModelCodingConfig } from "./local-model-coding-config";
import {
  FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK,
  generateCodingFilesWithLocalModel,
  generateCodingRepairWithLocalModel,
  type LocalModelCodingGenerationResult,
  type LocalModelCodingRepairContext,
} from "./local-openai-compatible-coding-client";
import {
  validateVeraLocalModelCodingProofHandoff,
  VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION,
  VERA_LOCAL_MODEL_CODING_TASK_ID,
} from "./local-model-coding-proof-contract";
import {
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
} from "./placeholder-module-card-contract";

export const VERA_LOCAL_MODEL_CODING_WORKSPACE_PREFIX = "vera-builder-loop-coding-" as const;
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2 as const;
const TEST_ARGS = ["--test", "src/formatBuilderLoopDecisionLabel.test.js"] as const;
const ALLOWED_RELATIVE_PATHS = new Set([
  "package.json",
  "src/formatBuilderLoopDecisionLabel.js",
  "src/formatBuilderLoopDecisionLabel.test.js",
]);

type BoundaryFlags = {
  local_model_coding_proof: true;
  system_source_of_truth: true;
  console_metadata_authoritative: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  final_integration_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  production_data_used: false;
  model_generation_real: boolean;
};

export type LocalModelCodingProofAttemptRecord = {
  attempt_number: number;
  generation_kind: "initial" | "repair";
  status: "passed" | "failed";
  prompt_summary: string;
  repair_prompt_summary?: string;
  test_exit_code: number;
  test_stdout: string;
  test_stderr: string;
  files_changed: string[];
};

export type LocalModelCodingProofRepairLoop = {
  max_repair_attempts: number;
  total_attempts: number;
  initial_status: "passed" | "failed";
  repair_attempts_count: number;
  repair_required: boolean;
  final_status: "passed" | "failed";
  repair_prompt_summary: string | null;
  attempts: LocalModelCodingProofAttemptRecord[];
};

export type VeraLocalModelCodingProofResult = {
  ok: boolean;
  status:
    | "local_model_coding_proof_passed"
    | "local_model_not_configured"
    | "local_model_unavailable"
    | "rejected"
    | "failed";
  schema_version: typeof VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION;
  placeholder_schema_version: typeof VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION;
  coding_task_id: typeof VERA_LOCAL_MODEL_CODING_TASK_ID;
  errors: string[];
  warnings: string[];
  model?: {
    provider: "local_openai_compatible";
    model_used: string;
    endpoint: string;
    model_generation_real: boolean;
    prompt_summary: string;
    repair_prompt_summary?: string | null;
  };
  patch?: {
    unified_diff: string;
    files_created_or_changed: string[];
  };
  tests?: {
    command_executable: "node";
    command_args: string[];
    exit_code: number;
    passed: boolean;
    stdout: string;
    stderr: string;
  };
  repair_loop?: LocalModelCodingProofRepairLoop;
  evidence?: {
    evidence_id: string;
    summary: string;
    workspace_type: "system_created_temp_workspace";
    workspace_id: string;
    workspace_retention: "cleaned_up" | "contained_for_test";
    workspace_exists_after_cleanup: boolean;
    checks_run: Array<{ name: string; status: "passed" | "failed"; summary: string }>;
    boundary_flags: BoundaryFlags;
  };
  boundary_flags: BoundaryFlags;
  execution_mode: "local_model_coding_proof";
  integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  final_integration_authorized: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  console_metadata_authoritative: false;
};

function boundaryFlags(modelGenerationReal: boolean): BoundaryFlags {
  return {
    local_model_coding_proof: true,
    system_source_of_truth: true,
    console_metadata_authoritative: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    final_integration_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    production_data_used: false,
    model_generation_real: modelGenerationReal,
  };
}

function baseResult(
  input: Partial<VeraLocalModelCodingProofResult> & Pick<VeraLocalModelCodingProofResult, "ok" | "status">,
  modelGenerationReal = false,
): VeraLocalModelCodingProofResult {
  const flags = boundaryFlags(modelGenerationReal);
  return {
    ok: input.ok,
    status: input.status,
    schema_version: VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION,
    placeholder_schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    ...(input.model ? { model: input.model } : {}),
    ...(input.patch ? { patch: input.patch } : {}),
    ...(input.tests ? { tests: input.tests } : {}),
    ...(input.repair_loop ? { repair_loop: input.repair_loop } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    boundary_flags: flags,
    execution_mode: "local_model_coding_proof",
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
    console_metadata_authoritative: false,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildUnifiedDiff(files: Array<{ relativePath: string; content: string }>): string {
  return files
    .map((file) => {
      const lines = file.content.replace(/\r\n/g, "\n").split("\n");
      const body = lines.map((line) => `+${line}`).join("\n");
      return [
        `--- /dev/null`,
        `+++ b/${file.relativePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
      ].join("\n");
    })
    .join("\n");
}

function writeWorkspaceFixture(workspacePath: string): void {
  fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, "package.json"),
    `${JSON.stringify({ name: "vera-local-model-coding-proof", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
}

function assertAllowedGeneratedFiles(files: Array<{ relativePath: string; content: string }>): void {
  for (const file of files) {
    if (!ALLOWED_RELATIVE_PATHS.has(file.relativePath)) {
      throw new Error(`Generated file path is not allowed: ${file.relativePath}`);
    }
  }
}

function writeGeneratedFiles(
  workspacePath: string,
  files: Array<{ relativePath: string; content: string }>,
): string[] {
  const written: string[] = [];
  for (const file of files) {
    const target = path.join(workspacePath, file.relativePath);
    const resolved = path.resolve(target);
    if (!resolved.startsWith(`${path.resolve(workspacePath)}${path.sep}`)) {
      throw new Error(`Generated file escaped workspace: ${file.relativePath}`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, file.content, "utf8");
    written.push(file.relativePath);
  }
  return written;
}

function resolveMaxRepairAttempts(deps: LocalModelCodingProofDeps): number {
  if (typeof deps.maxRepairAttempts === "number" && Number.isFinite(deps.maxRepairAttempts)) {
    return Math.max(0, Math.floor(deps.maxRepairAttempts));
  }
  const envValue = deps.env?.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MAX_REPAIR_ATTEMPTS
    ?? process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MAX_REPAIR_ATTEMPTS;
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return DEFAULT_MAX_REPAIR_ATTEMPTS;
}

async function runIsolatedTests(workspacePath: string) {
  return runBoundedCommand({
    cwd: workspacePath,
    executable: process.execPath,
    args: [...TEST_ARGS],
    timeoutMs: 30_000,
  });
}

function attemptStatus(exitCode: number): "passed" | "failed" {
  return exitCode === 0 ? "passed" : "failed";
}

export type LocalModelCodingProofDeps = {
  tempRoot?: string;
  workspaceId?: () => string;
  cleanup?: boolean;
  maxRepairAttempts?: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  generateCode?: (
    taskId: typeof VERA_LOCAL_MODEL_CODING_TASK_ID,
  ) => Promise<LocalModelCodingGenerationResult>;
  generateRepair?: (
    context: LocalModelCodingRepairContext,
  ) => Promise<LocalModelCodingGenerationResult>;
};

export async function runVeraLocalModelCodingProof(
  raw: unknown,
  deps: LocalModelCodingProofDeps = {},
): Promise<VeraLocalModelCodingProofResult> {
  const validation = validateVeraLocalModelCodingProofHandoff(raw);
  if (!validation.ok || !validation.handoff) {
    return baseResult({
      ok: false,
      status: "rejected",
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const config = getLocalModelCodingConfig(deps.env);
  if (!deps.generateCode && !config.enabled) {
    return baseResult({
      ok: false,
      status: "local_model_not_configured",
      errors: ["Local model coding proof requires ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true and a configured model id."],
      warnings: [
        "This proof does not use deterministic templates.",
        "Configure ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL and ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL to run a real local model coding proof.",
      ],
    });
  }
  if (!deps.generateCode && !config.model) {
    return baseResult({
      ok: false,
      status: "local_model_not_configured",
      errors: ["Local model id is not configured."],
      warnings: ["Set ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL or VERALUX_MODEL_TIER_FAST_MODEL."],
    });
  }

  const maxRepairAttempts = resolveMaxRepairAttempts(deps);
  const workspaceId = (deps.workspaceId?.() ?? sha256(`${Date.now()}-${Math.random()}`).slice(0, 12))
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const workspacePath = fs.mkdtempSync(
    path.join(deps.tempRoot ?? os.tmpdir(), `${VERA_LOCAL_MODEL_CODING_WORKSPACE_PREFIX}${workspaceId}-`),
  );
  const cleanup = deps.cleanup !== false;
  const testCommand = `node ${TEST_ARGS.join(" ")}`;

  try {
    writeWorkspaceFixture(workspacePath);

    let generation: LocalModelCodingGenerationResult;
    try {
      generation = deps.generateCode
        ? await deps.generateCode(VERA_LOCAL_MODEL_CODING_TASK_ID)
        : await generateCodingFilesWithLocalModel(
          {
            taskId: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.taskId,
            promptSummary: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.promptSummary,
            systemPrompt: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.systemPrompt,
            userPrompt: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.userPrompt,
          },
          config,
          deps.fetchFn,
        );
    } catch (error) {
      return baseResult({
        ok: false,
        status: deps.generateCode ? "failed" : "local_model_unavailable",
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: ["Local model generation failed before any repo mutation could occur."],
      });
    }

    assertAllowedGeneratedFiles(generation.files);
    let currentFiles = generation.files;
    let filesChanged = writeGeneratedFiles(workspacePath, currentFiles);
    let testResult = await runIsolatedTests(workspacePath);
    const attempts: LocalModelCodingProofAttemptRecord[] = [{
      attempt_number: 1,
      generation_kind: "initial",
      status: attemptStatus(testResult.exitCode),
      prompt_summary: generation.promptSummary,
      test_exit_code: testResult.exitCode,
      test_stdout: testResult.stdout,
      test_stderr: testResult.stderr,
      files_changed: filesChanged,
    }];

    const initialStatus = attempts[0]?.status ?? "failed";
    let repairAttemptsCount = 0;
    let latestRepairPromptSummary: string | null = null;
    let latestGeneration = generation;

    while (testResult.exitCode !== 0 && repairAttemptsCount < maxRepairAttempts) {
      repairAttemptsCount += 1;
      const repairContext: LocalModelCodingRepairContext = {
        taskId: VERA_LOCAL_MODEL_CODING_TASK_ID,
        attemptNumber: repairAttemptsCount,
        testCommand,
        testStdout: testResult.stdout,
        testStderr: testResult.stderr,
        currentFiles,
      };

      let repairGeneration: LocalModelCodingGenerationResult;
      try {
        repairGeneration = deps.generateRepair
          ? await deps.generateRepair(repairContext)
          : await generateCodingRepairWithLocalModel(repairContext, config, deps.fetchFn);
      } catch (error) {
        attempts.push({
          attempt_number: attempts.length + 1,
          generation_kind: "repair",
          status: "failed",
          prompt_summary: generation.promptSummary,
          repair_prompt_summary: `Repair attempt ${repairAttemptsCount} failed before tests could rerun.`,
          test_exit_code: testResult.exitCode,
          test_stdout: testResult.stdout,
          test_stderr: testResult.stderr,
          files_changed: filesChanged,
        });
        return baseResult({
          ok: false,
          status: deps.generateRepair ? "failed" : "local_model_unavailable",
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: ["Repair generation failed before any repo mutation could occur."],
          repair_loop: {
            max_repair_attempts: maxRepairAttempts,
            total_attempts: attempts.length,
            initial_status: initialStatus,
            repair_attempts_count: repairAttemptsCount,
            repair_required: initialStatus === "failed",
            final_status: "failed",
            repair_prompt_summary: latestRepairPromptSummary,
            attempts,
          },
        }, latestGeneration.modelGenerationReal);
      }

      assertAllowedGeneratedFiles(repairGeneration.files);
      latestRepairPromptSummary = repairGeneration.promptSummary;
      latestGeneration = repairGeneration;
      currentFiles = repairGeneration.files;
      filesChanged = writeGeneratedFiles(workspacePath, currentFiles);
      testResult = await runIsolatedTests(workspacePath);
      attempts.push({
        attempt_number: attempts.length + 1,
        generation_kind: "repair",
        status: attemptStatus(testResult.exitCode),
        prompt_summary: generation.promptSummary,
        repair_prompt_summary: repairGeneration.promptSummary,
        test_exit_code: testResult.exitCode,
        test_stdout: testResult.stdout,
        test_stderr: testResult.stderr,
        files_changed: filesChanged,
      });
    }

    const unifiedDiff = buildUnifiedDiff(currentFiles);
    const finalStatus = attemptStatus(testResult.exitCode);
    const repairRequired = initialStatus === "failed" && finalStatus === "passed";
    const repairLoop: LocalModelCodingProofRepairLoop = {
      max_repair_attempts: maxRepairAttempts,
      total_attempts: attempts.length,
      initial_status: initialStatus,
      repair_attempts_count: repairAttemptsCount,
      repair_required: repairRequired,
      final_status: finalStatus,
      repair_prompt_summary: latestRepairPromptSummary,
      attempts,
    };

    const checks = [
      {
        name: "generated_files_contained_in_workspace",
        status: filesChanged.every((file) => fs.existsSync(path.join(workspacePath, file))) ? "passed" as const : "failed" as const,
        summary: "Generated code files were written only inside the system-created temp workspace.",
      },
      {
        name: "patch_returned",
        status: unifiedDiff.includes("formatBuilderLoopDecisionLabel") ? "passed" as const : "failed" as const,
        summary: "Unified diff was generated for operator review.",
      },
      {
        name: "isolated_tests_executed",
        status: testResult.exitCode === 0 ? "passed" as const : "failed" as const,
        summary: testResult.exitCode === 0
          ? repairRequired
            ? "node --test passed inside the isolated workspace after bounded repair."
            : "node --test passed inside the isolated workspace."
          : `node --test failed with exit code ${testResult.exitCode}.`,
      },
    ];
    const passed = checks.every((check) => check.status === "passed");
    const previewIdSeed = sha256(`${workspaceId}:${unifiedDiff}:${attempts.length}`).slice(0, 16);
    if (cleanup) fs.rmSync(workspacePath, { recursive: true, force: true });

    const warnings = [
      "Coding proof is isolated and non-integrating.",
      latestGeneration.modelGenerationReal
        ? "Model generation was real via the configured local OpenAI-compatible endpoint."
        : "Model generation used an injected test provider response.",
    ];
    if (repairRequired) {
      warnings.push("Repair was required before isolated tests passed.");
    }
    if (!passed && repairAttemptsCount > 0) {
      warnings.push(`Bounded repair exhausted after ${repairAttemptsCount} repair attempt(s).`);
    }

    return baseResult({
      ok: passed,
      status: passed ? "local_model_coding_proof_passed" : "failed",
      errors: passed ? [] : checks.filter((check) => check.status === "failed").map((check) => check.summary),
      warnings,
      model: {
        provider: "local_openai_compatible",
        model_used: latestGeneration.modelUsed,
        endpoint: latestGeneration.endpoint,
        model_generation_real: latestGeneration.modelGenerationReal,
        prompt_summary: generation.promptSummary,
        repair_prompt_summary: latestRepairPromptSummary,
      },
      patch: {
        unified_diff: unifiedDiff,
        files_created_or_changed: filesChanged,
      },
      tests: {
        command_executable: "node",
        command_args: [...TEST_ARGS],
        exit_code: testResult.exitCode,
        passed: testResult.exitCode === 0,
        stdout: testResult.stdout,
        stderr: testResult.stderr,
      },
      repair_loop: repairLoop,
      evidence: {
        evidence_id: `local-model-coding-proof-${previewIdSeed}`,
        summary: passed
          ? repairRequired
            ? "Local model generated code in an isolated workspace, bounded repair corrected failing tests, and a reviewable patch was returned."
            : "Local model generated code in an isolated workspace, tests passed, and a reviewable patch was returned."
          : repairAttemptsCount > 0
            ? "Local model coding proof failed after bounded repair attempts and before any integration boundary was crossed."
            : "Local model coding proof failed before any integration boundary was crossed.",
        workspace_type: "system_created_temp_workspace",
        workspace_id: workspaceId,
        workspace_retention: cleanup ? "cleaned_up" : "contained_for_test",
        workspace_exists_after_cleanup: fs.existsSync(workspacePath),
        checks_run: checks,
        boundary_flags: boundaryFlags(latestGeneration.modelGenerationReal),
      },
    }, latestGeneration.modelGenerationReal);
  } catch (error) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return baseResult({
      ok: false,
      status: "failed",
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }
}
