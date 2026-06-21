import { execFile } from "child_process";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { resolveModelRole, type ModelRoleAssignment } from "../model-routing/model-role-routing";
import {
  runAirLlmEnvironmentProof,
  type AirLlmEnvironmentProofResult,
  type AirLlmEnvironmentVerdict,
} from "./airllm-environment-proof";

const execFileAsync = promisify(execFile);

export type AirLlmProvisionVerdict = AirLlmEnvironmentVerdict;
export type AirLlmProvisionStepStatus = "planned" | "skipped" | "passed" | "failed";

export interface AirLlmLocalVenvProvisionConfig {
  repoRoot: string;
  evidenceRoot: string;
  targetVenvPath: string;
  basePython: string;
  packageName: "airllm";
}

export interface AirLlmProvisionStep {
  name: string;
  status: AirLlmProvisionStepStatus;
  command: string[];
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  diagnostics: string[];
}

export interface AirLlmProvisionSafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface AirLlmLocalVenvProvisionResult {
  provision_id: string;
  timestamp: string;
  repo_root: string;
  target_venv_path: string;
  python_base_executable: string;
  commands_planned: string[][];
  commands_executed: AirLlmProvisionStep[];
  install_result: AirLlmProvisionStep;
  import_proof_result: AirLlmEnvironmentProofResult;
  senior_role_id: string;
  senior_role_resolution: ModelRoleAssignment;
  selected_runtime_path: string | null;
  airllm_package_version: string | null;
  airllm_module_path: string | null;
  dependency_snapshot: AirLlmEnvironmentProofResult["dependency_snapshot"];
  hardware_snapshot: AirLlmEnvironmentProofResult["hardware_snapshot"];
  safety_gates: AirLlmProvisionSafetyGate[];
  final_verdict: AirLlmProvisionVerdict;
  evidence_path: string;
  venv_gitignored: boolean;
  fallback_used: false;
  airllm_serving_started: false;
  super_used: false;
  qwen_used: false;
  super_model_load_performed: false;
  super_model_inference_performed: false;
  integration_performed: false;
  blocked_reasons: string[];
  warnings: string[];
}

export interface AirLlmLocalVenvProvisionOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  now?: () => Date;
  runner?: AirLlmProvisionCommandRunner;
  importProofRunner?: (env: NodeJS.ProcessEnv) => Promise<AirLlmEnvironmentProofResult>;
  env?: NodeJS.ProcessEnv;
  skipPipUpgrade?: boolean;
  safetyOverrides?: Partial<{
    superModelLoaded: boolean;
    seniorInferencePerformed: boolean;
    airllmServingStarted: boolean;
    qwenUsed: boolean;
    fallbackUsed: boolean;
    integrationPerformed: boolean;
    uncontrolledProcessOperation: boolean;
  }>;
}

export type AirLlmProvisionCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const DEFAULT_AIRLLM_LOCAL_VENV_CONFIG = {
  targetVenvPath: ".venv-airllm",
  basePython: "python3",
  packageName: "airllm" as const,
};

export function plannedAirLlmProvisionCommands(config: AirLlmLocalVenvProvisionConfig): string[][] {
  const python = path.join(config.targetVenvPath, "bin", "python");
  return [
    [config.basePython, "-m", "venv", config.targetVenvPath],
    [python, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
    [python, "-m", "pip", "install", config.packageName],
  ];
}

export function validateAirLlmProvisionCommand(command: string[]): string[] {
  const serialized = command.join(" ");
  const diagnostics: string[] = [];
  if (command[0] === "sudo") diagnostics.push("AIRLLM_PROVISION_SUDO_FORBIDDEN");
  if (command[0] === "apt" || command[0] === "apt-get") diagnostics.push("AIRLLM_PROVISION_APT_FORBIDDEN");
  if (command[0] === "pip" || command[0] === "pip3") diagnostics.push("AIRLLM_PROVISION_GLOBAL_PIP_FORBIDDEN");
  if (serialized.toLowerCase().includes("qwen")) diagnostics.push("AIRLLM_PROVISION_QWEN_FORBIDDEN");
  const allowedVenvCreate = command[0] === "python3"
    && command[1] === "-m"
    && command[2] === "venv"
    && command[3] === ".venv-airllm";
  const allowedVenvPip = command[0] === ".venv-airllm/bin/python"
    && command[1] === "-m"
    && command[2] === "pip"
    && command[3] === "install";
  if (!allowedVenvCreate && !allowedVenvPip) {
    diagnostics.push("AIRLLM_PROVISION_COMMAND_NOT_ALLOWLISTED");
  }
  return diagnostics;
}

export async function runAirLlmLocalVenvProvision(
  options: AirLlmLocalVenvProvisionOptions = {},
): Promise<AirLlmLocalVenvProvisionResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const evidenceRoot = options.evidenceRoot ?? "evidence/airllm-environment";
  const provisionId = `phase-10-airllm-local-venv-provision-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(evidenceRoot, `${provisionId}.json`);
  const config: AirLlmLocalVenvProvisionConfig = {
    repoRoot,
    evidenceRoot,
    targetVenvPath: DEFAULT_AIRLLM_LOCAL_VENV_CONFIG.targetVenvPath,
    basePython: DEFAULT_AIRLLM_LOCAL_VENV_CONFIG.basePython,
    packageName: DEFAULT_AIRLLM_LOCAL_VENV_CONFIG.packageName,
  };
  const planned = plannedAirLlmProvisionCommands(config);
  const runner = options.runner ?? defaultProvisionRunner;
  const venvPython = path.join(config.targetVenvPath, "bin", "python");
  const steps: AirLlmProvisionStep[] = [];
  const requirementsPath = "requirements-airllm.txt";
  const installCommand = await pathExists(path.join(repoRoot, requirementsPath))
    ? [venvPython, "-m", "pip", "install", "-r", requirementsPath]
    : planned[2];

  const createStep = await runProvisionStep({
    name: await pathExists(path.join(repoRoot, venvPython)) ? "reuse_local_venv" : "create_local_venv",
    command: planned[0],
    cwd: repoRoot,
    runner,
    skip: await pathExists(path.join(repoRoot, venvPython)),
    timeoutMs: 120_000,
  });
  steps.push(createStep);

  if (createStep.status !== "failed" && !options.skipPipUpgrade) {
    steps.push(await runProvisionStep({
      name: "upgrade_local_pip_tooling",
      command: planned[1],
      cwd: repoRoot,
      runner,
      timeoutMs: 180_000,
    }));
  }

  const installStep = steps.some((step) => step.status === "failed")
    ? skippedStep("install_airllm", installCommand, "AIRLLM_INSTALL_SKIPPED_DUE_TO_PRIOR_FAILURE")
    : await runProvisionStep({
      name: "install_airllm",
      command: installCommand,
      cwd: repoRoot,
      runner,
      timeoutMs: 600_000,
    });
  steps.push(installStep);

  const proofEnv = {
    ...process.env,
    ...options.env,
    AIRLLM_PYTHON: venvPython,
  };
  const proof = options.importProofRunner
    ? await options.importProofRunner(proofEnv)
    : await runAirLlmEnvironmentProof({
      evidenceRoot,
      env: proofEnv,
      safetyOverrides: options.safetyOverrides,
    });
  const seniorRole = resolveModelRole("console_senior_worker", options.env);
  const gitignored = await venvIsIgnored(repoRoot);
  const safetyGates = safetyGatesForProvision({
    proof,
    seniorRole,
    installStep,
    venvGitignored: gitignored,
    safetyOverrides: options.safetyOverrides,
  });
  const blockedReasons = [
    ...safetyGates
      .filter((gate) => gate.status === "failed")
      .map((gate) => `${gate.name}:${gate.message}`),
    ...proof.blocked_reasons,
  ];
  const finalVerdict: AirLlmProvisionVerdict = blockedReasons.length > 0
    ? "no_go"
    : installStep.status === "failed"
      ? "no_go"
      : proof.final_verdict;
  const result: AirLlmLocalVenvProvisionResult = {
    provision_id: provisionId,
    timestamp,
    repo_root: repoRoot,
    target_venv_path: config.targetVenvPath,
    python_base_executable: config.basePython,
    commands_planned: planned,
    commands_executed: steps,
    install_result: installStep,
    import_proof_result: proof,
    senior_role_id: seniorRole.roleId,
    senior_role_resolution: seniorRole,
    selected_runtime_path: proof.selected_runtime_path,
    airllm_package_version: proof.airllm_import_check.version,
    airllm_module_path: proof.airllm_import_check.module_path,
    dependency_snapshot: proof.dependency_snapshot,
    hardware_snapshot: proof.hardware_snapshot,
    safety_gates: safetyGates,
    final_verdict: finalVerdict,
    evidence_path: evidencePath,
    venv_gitignored: gitignored,
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
    blocked_reasons: blockedReasons,
    warnings: [
      ...proof.warnings,
      ...steps.flatMap((step) => step.diagnostics),
    ],
  };
  await writeJson(evidencePath, result);
  return result;
}

async function runProvisionStep(input: {
  name: string;
  command: string[];
  cwd: string;
  runner: AirLlmProvisionCommandRunner;
  skip?: boolean;
  timeoutMs: number;
}): Promise<AirLlmProvisionStep> {
  const diagnostics = validateAirLlmProvisionCommand(input.command);
  if (diagnostics.length > 0) {
    return {
      name: input.name,
      status: "failed",
      command: input.command,
      exit_code: null,
      stdout_summary: null,
      stderr_summary: null,
      diagnostics,
    };
  }
  if (input.skip) {
    return {
      name: input.name,
      status: "skipped",
      command: input.command,
      exit_code: null,
      stdout_summary: null,
      stderr_summary: null,
      diagnostics: ["AIRLLM_LOCAL_VENV_REUSED"],
    };
  }
  const [command, ...args] = input.command;
  const result = await input.runner(command, args, { cwd: input.cwd, timeoutMs: input.timeoutMs });
  return {
    name: input.name,
    status: result.exitCode === 0 ? "passed" : "failed",
    command: input.command,
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    diagnostics: result.exitCode === 0 ? [] : [`AIRLLM_PROVISION_STEP_FAILED:${input.name}:${result.exitCode}`],
  };
}

function skippedStep(name: string, command: string[], diagnostic: string): AirLlmProvisionStep {
  return {
    name,
    status: "skipped",
    command,
    exit_code: null,
    stdout_summary: null,
    stderr_summary: null,
    diagnostics: [diagnostic],
  };
}

function safetyGatesForProvision(input: {
  proof: AirLlmEnvironmentProofResult;
  seniorRole: ModelRoleAssignment;
  installStep: AirLlmProvisionStep;
  venvGitignored: boolean;
  safetyOverrides?: AirLlmLocalVenvProvisionOptions["safetyOverrides"];
}): AirLlmProvisionSafetyGate[] {
  const safety = input.safetyOverrides ?? {};
  return [
    gate("nano_roles_primary_and_healthy", input.proof.preflight_runtime_status === "healthy" && input.proof.postflight_runtime_status === "healthy", "Nano runtime remained healthy before and after provisioning."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("super_boot_not_attempted", input.proof.boot_probe_plan.status === "disabled", "Super boot probe remains disabled."),
    gate("no_super_model_load", safety.superModelLoaded !== true && !input.proof.super_model_load_performed, "No Super model load occurred."),
    gate("no_senior_inference", safety.seniorInferencePerformed !== true && !input.proof.super_model_inference_performed, "No senior inference occurred."),
    gate("no_airllm_serving", safety.airllmServingStarted !== true && !input.proof.airllm_serving_started, "No AirLLM serving process was started."),
    gate("qwen_not_used", safety.qwenUsed !== true && !input.proof.qwen_used, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true && !input.proof.fallback_used, "No fallback model was used."),
    gate("no_integration", safety.integrationPerformed !== true && !input.proof.integration_performed, "No integration occurred."),
    gate("local_venv_gitignored", input.venvGitignored, ".venv-airllm is ignored by git."),
    gate("install_local_to_venv", input.installStep.command[0] === ".venv-airllm/bin/python", "Install command targets .venv-airllm only."),
    gate("import_verification_no_model_path", input.proof.airllm_import_check.command !== null && !input.proof.airllm_import_check.command.includes("/mnt/large-storage/models"), "Import verification did not receive the Super model path."),
    gate("no_uncontrolled_process_operations", safety.uncontrolledProcessOperation !== true, "No uncontrolled process operations occurred."),
  ];
}

function gate(name: string, passed: boolean, message: string): AirLlmProvisionSafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
}

async function venvIsIgnored(repoRoot: string): Promise<boolean> {
  try {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    return gitignore.split(/\r?\n/).some((line) => line.trim() === "/.venv-airllm/" || line.trim() === ".venv-airllm/");
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

async function defaultProvisionRunner(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const maybeError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
    };
  }
}

function summarize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed;
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
