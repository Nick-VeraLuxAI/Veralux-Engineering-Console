import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBoundedCommand } from "@/lib/engineer-console/hermes-worker/hermes-bounded-command-runner";
import { getLocalModelCodingConfig } from "./local-model-coding-config";
import {
  resolveCodingTaskSpec,
  type ResolvedCodingTaskSpec,
} from "./local-model-coding-task";
import {
  listAllowedPathsForTask,
  validateGeneratedFilesForTask,
  type GeneratedFileRecord,
} from "./local-model-generated-files-validation";
import {
  validateVeraLocalModelCodingProofHandoff,
  VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION,
  type VeraLocalModelCodingProofHandoff,
} from "./local-model-coding-proof-contract";
import {
  fetchLocalModelCodingGeneration,
  tryParseGeneratedCodingFiles,
  type LocalModelCodingGenerationResult,
  type LocalModelCodingRepairContext,
  type LocalModelCodingRepairReason,
} from "./local-openai-compatible-coding-client";
import {
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
} from "./placeholder-module-card-contract";

export const VERA_LOCAL_MODEL_CODING_WORKSPACE_PREFIX = "vera-builder-loop-coding-" as const;
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2 as const;

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
  repair_reason?: LocalModelCodingRepairReason;
  validation_errors?: string[];
  rejected_paths?: string[];
  allowed_paths?: string[];
  test_exit_code: number;
  test_stdout: string;
  test_stderr: string;
  files_changed: string[];
};

export type LocalModelCodingProofOutputValidation = {
  rejected_paths: string[];
  allowed_paths: string[];
  validation_errors: string[];
  repair_attempted: boolean;
  final_paths_valid: boolean;
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
  coding_task_id: string;
  builder_loop_mode?: "preview_only" | "code_in_sandbox";
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
    command_executable: string;
    command_args: string[];
    exit_code: number;
    passed: boolean;
    stdout: string;
    stderr: string;
  };
  repair_loop?: LocalModelCodingProofRepairLoop;
  output_validation?: LocalModelCodingProofOutputValidation;
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
    coding_task_id: input.coding_task_id ?? "unknown",
    ...(input.builder_loop_mode ? { builder_loop_mode: input.builder_loop_mode } : {}),
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    ...(input.model ? { model: input.model } : {}),
    ...(input.patch ? { patch: input.patch } : {}),
    ...(input.tests ? { tests: input.tests } : {}),
    ...(input.repair_loop ? { repair_loop: input.repair_loop } : {}),
    ...(input.output_validation ? { output_validation: input.output_validation } : {}),
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

function writeWorkspaceFixture(workspacePath: string, handoff?: VeraLocalModelCodingProofHandoff): void {
  fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, "package.json"),
    `${JSON.stringify({ name: "vera-local-model-coding-proof", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  if (handoff?.coding_task) {
    fs.mkdirSync(path.join(workspacePath, "src/services/vera"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, "tsconfig.json"),
      `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
      }, null, 2)}\n`,
      "utf8",
    );
  }
}

function resolveGenerationFiles(generation: LocalModelCodingGenerationResult): GeneratedFileRecord[] {
  if (generation.files.length > 0) {
    return generation.files;
  }
  const parsed = tryParseGeneratedCodingFiles(generation.rawContent);
  return parsed.ok ? parsed.files : [];
}

type ResolvedGenerationValidation =
  | {
    ok: true;
    files: GeneratedFileRecord[];
    allowed_paths: string[];
  }
  | {
    ok: false;
    errors: string[];
    rejected_paths: string[];
    allowed_paths: string[];
    repair_reason: LocalModelCodingRepairReason;
  };

function validateGenerationOutput(
  generation: LocalModelCodingGenerationResult,
  taskSpec: ResolvedCodingTaskSpec,
  handoff: VeraLocalModelCodingProofHandoff,
): ResolvedGenerationValidation {
  const allowed_paths = listAllowedPathsForTask(handoff, taskSpec);

  if (generation.generation_error) {
    return {
      ok: false,
      errors: [generation.generation_error],
      rejected_paths: generation.rejected_paths ?? [],
      allowed_paths,
      repair_reason: "parse_failure",
    };
  }

  const files = resolveGenerationFiles(generation);
  const validation = validateGeneratedFilesForTask(files, taskSpec, handoff);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      rejected_paths: validation.rejected_paths,
      allowed_paths: validation.allowed_paths,
      repair_reason: "output_validation",
    };
  }

  return {
    ok: true,
    files: validation.files,
    allowed_paths: validation.allowed_paths,
  };
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

async function runIsolatedTests(
  workspacePath: string,
  taskSpec: ResolvedCodingTaskSpec,
) {
  return runBoundedCommand({
    cwd: workspacePath,
    executable: taskSpec.testCommand.executable,
    args: taskSpec.testCommand.args,
    timeoutMs: 60_000,
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
    taskId: string,
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

  const handoff = validation.handoff;
  const taskSpec = resolveCodingTaskSpec(handoff);
  const resultContext = {
    coding_task_id: handoff.coding_task_id,
    ...(handoff.builder_loop_mode ? { builder_loop_mode: handoff.builder_loop_mode } : {}),
  };

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
      ...resultContext,
    });
  }
  if (!deps.generateCode && !config.model) {
    return baseResult({
      ok: false,
      status: "local_model_not_configured",
      errors: ["Local model id is not configured."],
      warnings: ["Set ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL or VERALUX_MODEL_TIER_FAST_MODEL."],
      ...resultContext,
    });
  }

  const maxRepairAttempts = resolveMaxRepairAttempts(deps);
  const workspaceId = (deps.workspaceId?.() ?? sha256(`${Date.now()}-${Math.random()}`).slice(0, 12))
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const workspacePath = fs.mkdtempSync(
    path.join(deps.tempRoot ?? os.tmpdir(), `${VERA_LOCAL_MODEL_CODING_WORKSPACE_PREFIX}${workspaceId}-`),
  );
  const cleanup = deps.cleanup !== false;
  const testCommand = taskSpec.testCommand.label;

  try {
    writeWorkspaceFixture(workspacePath, handoff);

    async function fetchGeneration(
      request: ReturnType<ResolvedCodingTaskSpec["buildGenerationRequest"]>,
    ): Promise<LocalModelCodingGenerationResult> {
      if (deps.generateCode) {
        return deps.generateCode(taskSpec.taskId);
      }
      return fetchLocalModelCodingGeneration(request, config, deps.fetchFn);
    }

    let generation: LocalModelCodingGenerationResult;
    try {
      generation = await fetchGeneration(taskSpec.buildGenerationRequest());
    } catch (error) {
      return baseResult({
        ok: false,
        status: deps.generateCode ? "failed" : "local_model_unavailable",
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: ["Local model generation failed before any repo mutation could occur."],
        ...resultContext,
      });
    }

    let currentFiles: GeneratedFileRecord[] = [];
    let filesChanged: string[] = [];
    let testResult = { exitCode: 1, stdout: "", stderr: "" };
    const attempts: LocalModelCodingProofAttemptRecord[] = [];
    let repairAttemptsCount = 0;
    let latestRepairPromptSummary: string | null = null;
    let latestGeneration = generation;
    let latestOutputValidation: LocalModelCodingProofOutputValidation = {
      rejected_paths: [],
      allowed_paths: listAllowedPathsForTask(handoff, taskSpec),
      validation_errors: [],
      repair_attempted: false,
      final_paths_valid: false,
    };
    let outputValidationRepairAttempted = false;
    let initialStatus: "passed" | "failed" = "failed";
    let completed = false;

    while (!completed) {
      const outputValidation = validateGenerationOutput(latestGeneration, taskSpec, handoff);
      latestOutputValidation = {
        rejected_paths: outputValidation.ok ? [] : outputValidation.rejected_paths,
        allowed_paths: outputValidation.allowed_paths,
        validation_errors: outputValidation.ok ? [] : outputValidation.errors,
        repair_attempted: outputValidationRepairAttempted,
        final_paths_valid: outputValidation.ok,
      };

      if (!outputValidation.ok) {
        attempts.push({
          attempt_number: attempts.length + 1,
          generation_kind: attempts.length === 0 ? "initial" : "repair",
          status: "failed",
          prompt_summary: latestGeneration.promptSummary,
          repair_prompt_summary: latestRepairPromptSummary ?? undefined,
          repair_reason: outputValidation.repair_reason,
          validation_errors: outputValidation.errors,
          rejected_paths: outputValidation.rejected_paths,
          allowed_paths: outputValidation.allowed_paths,
          test_exit_code: 1,
          test_stdout: "",
          test_stderr: outputValidation.errors.join("; "),
          files_changed: [],
        });
        if (attempts.length === 1) {
          initialStatus = "failed";
        }

        if (repairAttemptsCount >= maxRepairAttempts) {
          break;
        }

        repairAttemptsCount += 1;
        outputValidationRepairAttempted = true;
        const repairContext: LocalModelCodingRepairContext = {
          taskId: taskSpec.taskId,
          attemptNumber: repairAttemptsCount,
          testCommand,
          testStdout: "",
          testStderr: outputValidation.errors.join("; "),
          currentFiles,
          repairReason: outputValidation.repair_reason,
          validationErrors: outputValidation.errors,
          allowedPaths: outputValidation.allowed_paths,
          rejectedPaths: outputValidation.rejected_paths,
          parseError: latestGeneration.generation_error,
        };

        try {
          latestGeneration = deps.generateRepair
            ? await deps.generateRepair(repairContext)
            : await fetchGeneration(taskSpec.buildRepairRequest(repairContext));
        } catch (error) {
          latestOutputValidation.repair_attempted = true;
          return baseResult({
            ok: false,
            status: deps.generateRepair ? "failed" : "local_model_unavailable",
            errors: [error instanceof Error ? error.message : String(error)],
            warnings: ["Repair generation failed before any repo mutation could occur."],
            output_validation: latestOutputValidation,
            repair_loop: {
              max_repair_attempts: maxRepairAttempts,
              total_attempts: attempts.length,
              initial_status: initialStatus,
              repair_attempts_count: repairAttemptsCount,
              repair_required: false,
              final_status: "failed",
              repair_prompt_summary: latestRepairPromptSummary,
              attempts,
            },
            ...resultContext,
          }, latestGeneration.modelGenerationReal);
        }

        latestRepairPromptSummary = latestGeneration.promptSummary;
        continue;
      }

      currentFiles = outputValidation.files;
      latestOutputValidation.final_paths_valid = true;
      filesChanged = writeGeneratedFiles(workspacePath, currentFiles);
      testResult = await runIsolatedTests(workspacePath, taskSpec);
      attempts.push({
        attempt_number: attempts.length + 1,
        generation_kind: outputValidationRepairAttempted || attempts.length > 0 ? "repair" : "initial",
        status: attemptStatus(testResult.exitCode),
        prompt_summary: generation.promptSummary,
        repair_prompt_summary: latestRepairPromptSummary ?? undefined,
        repair_reason: attempts.length === 1 ? undefined : "test_failure",
        allowed_paths: outputValidation.allowed_paths,
        test_exit_code: testResult.exitCode,
        test_stdout: testResult.stdout,
        test_stderr: testResult.stderr,
        files_changed: filesChanged,
      });

      if (attempts.length === 1) {
        initialStatus = attempts[0]?.status ?? "failed";
      }

      if (testResult.exitCode === 0) {
        completed = true;
        break;
      }

      if (repairAttemptsCount >= maxRepairAttempts) {
        break;
      }

      repairAttemptsCount += 1;
      const repairContext: LocalModelCodingRepairContext = {
        taskId: taskSpec.taskId,
        attemptNumber: repairAttemptsCount,
        testCommand,
        testStdout: testResult.stdout,
        testStderr: testResult.stderr,
        currentFiles,
        repairReason: "test_failure",
        allowedPaths: outputValidation.allowed_paths,
      };

      try {
        latestGeneration = deps.generateRepair
          ? await deps.generateRepair(repairContext)
          : await fetchGeneration(taskSpec.buildRepairRequest(repairContext));
      } catch (error) {
        attempts.push({
          attempt_number: attempts.length + 1,
          generation_kind: "repair",
          status: "failed",
          prompt_summary: generation.promptSummary,
          repair_prompt_summary: `Repair attempt ${repairAttemptsCount} failed before tests could rerun.`,
          repair_reason: "test_failure",
          allowed_paths: outputValidation.allowed_paths,
          test_exit_code: testResult.exitCode,
          test_stdout: testResult.stdout,
          test_stderr: testResult.stderr,
          files_changed: filesChanged,
        });
        latestOutputValidation.repair_attempted = outputValidationRepairAttempted || repairAttemptsCount > 0;
        return baseResult({
          ok: false,
          status: deps.generateRepair ? "failed" : "local_model_unavailable",
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: ["Repair generation failed before any repo mutation could occur."],
          output_validation: latestOutputValidation,
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
          ...resultContext,
        }, latestGeneration.modelGenerationReal);
      }

      latestRepairPromptSummary = latestGeneration.promptSummary;
    }

    latestOutputValidation.repair_attempted = outputValidationRepairAttempted || repairAttemptsCount > 0;

    const unifiedDiff = currentFiles.length > 0 ? buildUnifiedDiff(currentFiles) : "";
    const finalStatus = latestOutputValidation.final_paths_valid
      ? attemptStatus(testResult.exitCode)
      : "failed";
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
        name: "generated_output_paths_valid",
        status: latestOutputValidation.final_paths_valid ? "passed" as const : "failed" as const,
        summary: latestOutputValidation.final_paths_valid
          ? "Generated file paths matched the bounded allowlist."
          : `Generated file paths failed validation: ${latestOutputValidation.validation_errors.join("; ") || "unknown validation error"}`,
      },
      {
        name: "generated_files_contained_in_workspace",
        status: latestOutputValidation.final_paths_valid
          && filesChanged.every((file) => fs.existsSync(path.join(workspacePath, file)))
          ? "passed" as const
          : "failed" as const,
        summary: "Generated code files were written only inside the system-created temp workspace.",
      },
      {
        name: "patch_returned",
        status: unifiedDiff.trim().length > 0 && filesChanged.length > 0 ? "passed" as const : "failed" as const,
        summary: "Unified diff was generated for operator review.",
      },
      {
        name: "isolated_tests_executed",
        status: latestOutputValidation.final_paths_valid && testResult.exitCode === 0 ? "passed" as const : "failed" as const,
        summary: !latestOutputValidation.final_paths_valid
          ? "Isolated tests were not executed because model output path validation failed."
          : testResult.exitCode === 0
            ? repairRequired
              ? `${testCommand} passed inside the isolated workspace after bounded repair.`
              : `${testCommand} passed inside the isolated workspace.`
            : `${testCommand} failed with exit code ${testResult.exitCode}.`,
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
    if (outputValidationRepairAttempted) {
      warnings.push("Bounded repair was used to correct invalid model output paths or format.");
    }
    if (!passed && repairAttemptsCount > 0) {
      warnings.push(`Bounded repair exhausted after ${repairAttemptsCount} repair attempt(s).`);
    }

    const failureErrors = passed
      ? []
      : [
        ...latestOutputValidation.validation_errors,
        ...checks.filter((check) => check.status === "failed").map((check) => check.summary),
      ].filter((value, index, array) => array.indexOf(value) === index);

    return baseResult({
      ok: passed,
      status: passed
        ? "local_model_coding_proof_passed"
        : latestOutputValidation.final_paths_valid
          ? "failed"
          : "local_model_unavailable",
      errors: failureErrors,
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
        command_executable: path.basename(taskSpec.testCommand.executable),
        command_args: taskSpec.testCommand.args,
        exit_code: testResult.exitCode,
        passed: latestOutputValidation.final_paths_valid && testResult.exitCode === 0,
        stdout: testResult.stdout,
        stderr: testResult.stderr,
      },
      repair_loop: repairLoop,
      output_validation: latestOutputValidation,
      ...resultContext,
      evidence: {
        evidence_id: `local-model-coding-proof-${previewIdSeed}`,
        summary: passed
          ? repairRequired
            ? "Local model generated code in an isolated workspace, bounded repair corrected failing tests, and a reviewable patch was returned."
            : "Local model generated code in an isolated workspace, tests passed, and a reviewable patch was returned."
          : latestOutputValidation.final_paths_valid
            ? repairAttemptsCount > 0
              ? "Local model coding proof failed after bounded repair attempts and before any integration boundary was crossed."
              : "Local model coding proof failed before any integration boundary was crossed."
            : "Local model coding proof rejected invalid model output paths/format before any integration boundary was crossed.",
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
      ...resultContext,
    });
  }
}
