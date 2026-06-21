import { execFile } from "child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { resolveModelRole, type ModelRoleAssignment } from "../model-routing/model-role-routing";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";
import {
  runAirLlmCompatibilityMatrix,
  runAirLlmImportProbe,
  type AirLlmCompatibilityMatrixResult,
  type AirLlmImportProbeResult,
} from "./airllm-compatibility-matrix";
import {
  runAirLlmEnvironmentProof,
  type AirLlmEnvironmentProofResult,
} from "./airllm-environment-proof";

const execFileAsync = promisify(execFile);

export type AirLlmPromotionVerdict = "ready_for_guarded_boot_probe" | "unknown" | "no_go";
export type AirLlmPromotionStepStatus = "passed" | "failed" | "skipped";

export interface AirLlmWinningCandidateLock {
  candidate_id: string;
  pins: string[];
  full_freeze: string[];
  source_phase11_evidence_path: string;
}

export interface AirLlmPromotionStep {
  name: string;
  status: AirLlmPromotionStepStatus;
  command: string[];
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  diagnostics: string[];
}

export interface AirLlmPromotionSafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface AirLlmWinningCandidatePromotionResult {
  promotion_id: string;
  timestamp: string;
  source_phase11_evidence_path: string;
  winning_candidate_id: string;
  winning_package_stack: string[];
  target_venv_path: ".venv-airllm";
  base_python_executable: string;
  commands_planned: string[][];
  commands_executed: AirLlmPromotionStep[];
  generated_requirements_path: string;
  generated_lock_path: string;
  installed_package_versions: Record<string, string | null>;
  import_probe_result: AirLlmImportProbeResult;
  import_proof_result: AirLlmEnvironmentProofResult;
  compatibility_matrix_result: AirLlmCompatibilityMatrixResult | null;
  selected_runtime_path: string | null;
  senior_role_resolution: ModelRoleAssignment;
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  safety_gates: AirLlmPromotionSafetyGate[];
  final_verdict: AirLlmPromotionVerdict;
  evidence_path: string;
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

export interface AirLlmWinningCandidatePromotionOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  phase11EvidencePath: string;
  now?: () => Date;
  runner?: AirLlmPromotionCommandRunner;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  importProbeRunner?: (pythonExecutable: string) => Promise<AirLlmImportProbeResult>;
  environmentProofRunner?: (env: NodeJS.ProcessEnv) => Promise<AirLlmEnvironmentProofResult>;
  matrixRunner?: () => Promise<AirLlmCompatibilityMatrixResult>;
  env?: NodeJS.ProcessEnv;
  allowNonA2Winner?: boolean;
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

export type AirLlmPromotionCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const PHASE_12_WINNING_PINS = [
  "airllm==2.11.0",
  "optimum==1.27.0",
  "transformers==4.48.3",
  "setuptools==81.0.0",
  "sentencepiece==0.2.1",
];

const TARGET_VENV = ".venv-airllm" as const;
const TARGET_PYTHON = ".venv-airllm/bin/python";
const REQUIREMENTS_PATH = "requirements-airllm.txt";
const LOCK_PATH = "docs/runtime/phase-12-airllm-freeze-a2.txt";

export async function loadWinningCandidateFromPhase11Evidence(input: {
  evidencePath: string;
  allowNonA2Winner?: boolean;
}): Promise<AirLlmWinningCandidateLock> {
  const raw = await readFile(input.evidencePath, "utf8");
  const parsed = JSON.parse(raw) as {
    winner_candidate_id?: string | null;
    final_verdict?: string;
    package_freeze_for_winner?: string[];
  };
  if (parsed.final_verdict !== "ready_for_guarded_boot_probe") {
    throw new Error("PHASE_12_PHASE_11_WINNER_NOT_READY");
  }
  if (!parsed.winner_candidate_id) {
    throw new Error("PHASE_12_PHASE_11_WINNER_MISSING");
  }
  if (parsed.winner_candidate_id !== "a2" && !input.allowNonA2Winner) {
    throw new Error(`PHASE_12_REJECTS_NON_A2_WINNER:${parsed.winner_candidate_id}`);
  }
  const freeze = Array.isArray(parsed.package_freeze_for_winner) ? parsed.package_freeze_for_winner : [];
  validateWinningPins(freeze);
  return {
    candidate_id: parsed.winner_candidate_id,
    pins: PHASE_12_WINNING_PINS,
    full_freeze: freeze,
    source_phase11_evidence_path: input.evidencePath,
  };
}

export function renderAirLlmRequirements(lock: AirLlmWinningCandidateLock): string {
  return [
    "# Generated from Phase 11 AirLLM compatibility winner a2.",
    "# Used only for project-local .venv-airllm promotion/import proof.",
    "# Import-only proven; not a Super boot proof and not for global Python.",
    ...lock.pins,
    "",
  ].join("\n");
}

export function validateAirLlmPromotionCommand(command: string[]): string[] {
  const serialized = command.join(" ");
  const diagnostics: string[] = [];
  if (command[0] === "sudo") diagnostics.push("AIRLLM_PROMOTION_SUDO_FORBIDDEN");
  if (command[0] === "apt" || command[0] === "apt-get") diagnostics.push("AIRLLM_PROMOTION_APT_FORBIDDEN");
  if (command[0] === "pip" || command[0] === "pip3") diagnostics.push("AIRLLM_PROMOTION_GLOBAL_PIP_FORBIDDEN");
  if (serialized.toLowerCase().includes("qwen")) diagnostics.push("AIRLLM_PROMOTION_QWEN_FORBIDDEN");
  if (serialized.includes("/mnt/large-storage/models")) diagnostics.push("AIRLLM_PROMOTION_MODEL_PATH_FORBIDDEN");
  if (serialized.includes(".airllm-matrix/venv-a2/bin/python -m pip")) diagnostics.push("AIRLLM_PROMOTION_MATRIX_VENV_MUTATION_FORBIDDEN");
  const isCreate = command[0] === "python3" && command[1] === "-m" && command[2] === "venv" && command[3] === TARGET_VENV;
  const isPip = command[0] === TARGET_PYTHON && command[1] === "-m" && command[2] === "pip";
  const isProbe = command[0] === TARGET_PYTHON && command[1] === "-c";
  const isGit = command[0] === "git" && command[1] === "rev-parse";
  const isNvidia = command[0] === "nvidia-smi";
  if (!isCreate && !isPip && !isProbe && !isGit && !isNvidia) {
    diagnostics.push("AIRLLM_PROMOTION_COMMAND_NOT_ALLOWLISTED");
  }
  return diagnostics;
}

export async function runAirLlmWinningCandidatePromotion(
  options: AirLlmWinningCandidatePromotionOptions,
): Promise<AirLlmWinningCandidatePromotionResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const evidenceRoot = options.evidenceRoot ?? "evidence/airllm-environment";
  const promotionId = `phase-12-airllm-promote-winning-candidate-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(evidenceRoot, `${promotionId}.json`);
  const runner = options.runner ?? defaultRunner;
  const lock = await loadWinningCandidateFromPhase11Evidence({
    evidencePath: options.phase11EvidencePath,
    allowNonA2Winner: options.allowNonA2Winner,
  });
  const preflight = await runCheckOnlyPreflight(options);
  const seniorRole = resolveModelRole("console_senior_worker", options.env);
  await writeRequirementsArtifacts(repoRoot, lock);
  const commandsPlanned = [
    ["python3", "-m", "venv", TARGET_VENV],
    [TARGET_PYTHON, "-m", "pip", "install", "--upgrade", "pip", "wheel"],
    [TARGET_PYTHON, "-m", "pip", "install", "setuptools==81.0.0"],
    [TARGET_PYTHON, "-m", "pip", "install", "-r", REQUIREMENTS_PATH],
  ];
  const beforeExists = await pathExists(path.join(repoRoot, TARGET_PYTHON));
  await rm(path.join(repoRoot, TARGET_VENV), { recursive: true, force: true });
  const steps: AirLlmPromotionStep[] = [
    {
      name: beforeExists ? "remove_existing_official_venv" : "official_venv_absent",
      status: "passed",
      command: ["rm", "-rf", TARGET_VENV],
      exit_code: 0,
      stdout_summary: null,
      stderr_summary: null,
      diagnostics: beforeExists ? ["AIRLLM_OFFICIAL_VENV_REBUILT_FOR_PHASE_12"] : ["AIRLLM_OFFICIAL_VENV_CREATED_FOR_PHASE_12"],
    },
  ];
  for (const command of commandsPlanned) {
    const step = await runPromotionStep(commandName(command), command, { repoRoot, runner, env: options.env });
    steps.push(step);
    if (step.status === "failed") break;
  }
  const installFailed = steps.some((step) => step.status === "failed");
  const importProbe = installFailed
    ? emptyProbe("skipped", ["AIRLLM_PROMOTION_INSTALL_FAILED"])
    : options.importProbeRunner
      ? await options.importProbeRunner(TARGET_PYTHON)
      : await runAirLlmImportProbe({ pythonExecutable: TARGET_PYTHON, repoRoot, runner: promotionRunnerAdapter(runner), env: options.env });
  const proofEnv = { ...process.env, ...options.env, AIRLLM_PYTHON: TARGET_PYTHON };
  const environmentProof = installFailed
    ? emptyEnvironmentProof(seniorRole, evidenceRoot)
    : options.environmentProofRunner
      ? await options.environmentProofRunner(proofEnv)
      : await runAirLlmEnvironmentProof({ evidenceRoot, env: proofEnv });
  const compatibilityMatrix = options.matrixRunner ? await options.matrixRunner() : null;
  const postflight = await runCheckOnlyPreflight(options);
  const venvIgnored = await ignored(repoRoot, "/.venv-airllm/");
  const matrixIgnored = await ignored(repoRoot, "/.airllm-matrix/");
  const gates = evaluatePromotionGates({
    preflightStatus: preflight.status,
    postflightStatus: postflight.status,
    seniorRole,
    venvIgnored,
    matrixIgnored,
    lock,
    importProbe,
    environmentProof,
    safetyOverrides: options.safetyOverrides,
  });
  const blockedReasons = gates.filter((gate) => gate.status === "failed").map((gate) => `${gate.name}:${gate.message}`);
  const finalVerdict: AirLlmPromotionVerdict = blockedReasons.length > 0 || installFailed || importProbe.status === "failed" || environmentProof.final_verdict === "no_go"
    ? "no_go"
    : importProbe.status === "passed" && environmentProof.final_verdict === "ready_for_guarded_boot_probe"
      ? "ready_for_guarded_boot_probe"
      : "unknown";
  const result: AirLlmWinningCandidatePromotionResult = {
    promotion_id: promotionId,
    timestamp,
    source_phase11_evidence_path: options.phase11EvidencePath,
    winning_candidate_id: lock.candidate_id,
    winning_package_stack: lock.pins,
    target_venv_path: TARGET_VENV,
    base_python_executable: "python3",
    commands_planned: commandsPlanned,
    commands_executed: steps,
    generated_requirements_path: REQUIREMENTS_PATH,
    generated_lock_path: LOCK_PATH,
    installed_package_versions: importProbe.installed_versions,
    import_probe_result: importProbe,
    import_proof_result: environmentProof,
    compatibility_matrix_result: compatibilityMatrix,
    selected_runtime_path: importProbe.status === "passed" ? TARGET_PYTHON : null,
    senior_role_resolution: seniorRole,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    safety_gates: gates,
    final_verdict: finalVerdict,
    evidence_path: evidencePath,
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
    blocked_reasons: blockedReasons,
    warnings: [
      ...steps.flatMap((step) => step.diagnostics),
      ...importProbe.diagnostics,
      ...environmentProof.warnings,
    ],
  };
  await writeJson(evidencePath, result);
  return result;
}

async function writeRequirementsArtifacts(repoRoot: string, lock: AirLlmWinningCandidateLock): Promise<void> {
  await writeFile(path.join(repoRoot, REQUIREMENTS_PATH), renderAirLlmRequirements(lock), "utf8");
  await mkdir(path.dirname(path.join(repoRoot, LOCK_PATH)), { recursive: true });
  await writeFile(path.join(repoRoot, LOCK_PATH), [
    "# Full freeze from Phase 11 winning AirLLM candidate a2.",
    "# Documentation only; do not install globally.",
    ...lock.full_freeze,
    "",
  ].join("\n"), "utf8");
}

async function runPromotionStep(
  name: string,
  command: string[],
  input: { repoRoot: string; runner: AirLlmPromotionCommandRunner; env?: NodeJS.ProcessEnv },
): Promise<AirLlmPromotionStep> {
  const diagnostics = validateAirLlmPromotionCommand(command);
  if (diagnostics.length > 0) {
    return { name, status: "failed", command, exit_code: null, stdout_summary: null, stderr_summary: null, diagnostics };
  }
  const [bin, ...args] = command;
  const result = await input.runner(bin, args, { cwd: input.repoRoot, timeoutMs: 900_000, env: input.env });
  return {
    name,
    status: result.exitCode === 0 ? "passed" : "failed",
    command,
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    diagnostics: result.exitCode === 0 ? [] : [`AIRLLM_PROMOTION_STEP_FAILED:${name}:${result.exitCode}`],
  };
}

function evaluatePromotionGates(input: {
  preflightStatus: string | null;
  postflightStatus: string | null;
  seniorRole: ModelRoleAssignment;
  venvIgnored: boolean;
  matrixIgnored: boolean;
  lock: AirLlmWinningCandidateLock;
  importProbe: AirLlmImportProbeResult;
  environmentProof: AirLlmEnvironmentProofResult;
  safetyOverrides?: AirLlmWinningCandidatePromotionOptions["safetyOverrides"];
}): AirLlmPromotionSafetyGate[] {
  const safety = input.safetyOverrides ?? {};
  return [
    gate("nano_roles_primary_and_healthy", input.preflightStatus === "healthy" && input.postflightStatus === "healthy", "Nano runtime remained healthy before and after promotion."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("official_venv_gitignored", input.venvIgnored, ".venv-airllm is ignored by git."),
    gate("matrix_venv_gitignored", input.matrixIgnored, ".airllm-matrix is ignored by git."),
    gate("pins_match_phase11_winner", pinsMatch(input.lock.pins), "Package pins exactly match Phase 11 winner a2."),
    gate("official_import_probe_passed", input.importProbe.status === "passed", "Official .venv-airllm import probe passed."),
    gate("automodel_import_resolved", input.importProbe.airllm_automodel_resolved, "from airllm import AutoModel resolved."),
    gate("phase9_import_proof_ready", input.environmentProof.final_verdict === "ready_for_guarded_boot_probe", "Phase 9 import-only proof is ready_for_guarded_boot_probe."),
    gate("boot_probe_disabled", input.environmentProof.boot_probe_plan.status === "disabled", "Boot probe remains disabled."),
    gate("no_model_path_passed", !input.importProbe.model_path_passed, "Import verification did not receive a model path."),
    gate("no_super_model_load", safety.superModelLoaded !== true && !input.importProbe.model_load_performed, "No Super model load occurred."),
    gate("no_senior_inference", safety.seniorInferencePerformed !== true && !input.importProbe.inference_performed, "No senior inference occurred."),
    gate("no_airllm_serving", safety.airllmServingStarted !== true && !input.importProbe.serving_started, "No AirLLM serving process was started."),
    gate("qwen_not_used", safety.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true, "No fallback model was used."),
    gate("no_integration", safety.integrationPerformed !== true, "No integration occurred."),
    gate("no_uncontrolled_process_operations", safety.uncontrolledProcessOperation !== true, "No uncontrolled process operations occurred."),
  ];
}

function validateWinningPins(freeze: string[]): void {
  const missing = PHASE_12_WINNING_PINS.filter((pin) => !freeze.includes(pin));
  if (missing.length > 0) throw new Error(`PHASE_12_WINNING_PINS_MISSING:${missing.join(",")}`);
}

function pinsMatch(pins: string[]): boolean {
  return pins.length === PHASE_12_WINNING_PINS.length && PHASE_12_WINNING_PINS.every((pin) => pins.includes(pin));
}

function commandName(command: string[]): string {
  if (command[1] === "-m" && command[2] === "venv") return "create_official_venv";
  if (command.includes("--upgrade")) return "upgrade_official_pip_tooling";
  if (command.includes("setuptools==81.0.0")) return "pin_official_setuptools";
  if (command.includes("-r")) return "install_official_airllm_requirements";
  return "promotion_command";
}

async function runCheckOnlyPreflight(options: AirLlmWinningCandidatePromotionOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function promotionRunnerAdapter(runner: AirLlmPromotionCommandRunner) {
  return async (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }) => runner(command, args, options);
}

async function ignored(repoRoot: string, pattern: string): Promise<boolean> {
  const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
  return gitignore.split(/\r?\n/).some((line) => line.trim() === pattern);
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

function emptyProbe(status: AirLlmImportProbeResult["status"], diagnostics: string[]): AirLlmImportProbeResult {
  return {
    status,
    command: null,
    exit_code: null,
    stdout_summary: null,
    stderr_summary: null,
    timed_out: false,
    python_executable: null,
    python_version: null,
    installed_versions: {},
    optimum_import_resolved: false,
    optimum_bettertransformer_resolved: false,
    airllm_import_resolved: false,
    airllm_automodel_resolved: false,
    model_path_passed: false,
    model_instantiated: false,
    model_load_performed: false,
    inference_performed: false,
    serving_started: false,
    error_class: null,
    error_message: null,
    traceback_summary: null,
    gpu_memory_before: null,
    gpu_memory_after: null,
    diagnostics,
  };
}

function emptyEnvironmentProof(seniorRole: ModelRoleAssignment, evidenceRoot: string): AirLlmEnvironmentProofResult {
  return {
    proof_id: "phase-12-skipped-airllm-environment-proof",
    timestamp: new Date().toISOString(),
    senior_role_id: seniorRole.roleId,
    senior_role_resolution: seniorRole,
    configured_provider: seniorRole.provider,
    configured_model_path: seniorRole.endpoint,
    expected_model: seniorRole.model,
    proof_mode: "import_only_no_model_load",
    python_runtime_candidates: [],
    selected_runtime_path: null,
    airllm_import_check: { status: "unknown", candidate: null, command: null, exit_code: null, stdout: null, stderr: null, package_found: false, import_succeeded: false, version: null, module_path: null, diagnostics: ["AIRLLM_PROMOTION_INSTALL_FAILED"] },
    dependency_snapshot: { status: "unknown", python_executable: null, python_version: null, airllm_distribution_version: null, torch_version: null, torch_cuda_available: null, torch_cuda_version: null, nvidia_smi_summary: null, safe_environment: {}, diagnostics: ["AIRLLM_PROMOTION_INSTALL_FAILED"] },
    model_artifact_check: { status: "unknown", configured_uri: seniorRole.endpoint, model_path: null, path_exists: false, readable: false, expected_model_name_consistent: false, config_files: [], tokenizer_files: [], weight_files: [], index_files: [], total_size_bytes: 0, partial_artifact_indicators: [], diagnostics: [] },
    hardware_snapshot: {
      status: "unknown",
      gpu_summary: null,
      memory_summary: { total_bytes: null, free_bytes: null },
      disk_summary: { path: null, total_bytes: null, free_bytes: null },
      diagnostics: [],
    },
    safety_gates: [],
    boot_probe_plan: { mode: "disabled", status: "disabled", required_guards: [], guards_satisfied: [], blocked_reason: "PHASE_12_INSTALL_FAILED", command: null },
    preflight_runtime_report_path: null,
    postflight_runtime_report_path: null,
    preflight_runtime_status: null,
    postflight_runtime_status: null,
    final_verdict: "unknown",
    blocked_reasons: [],
    warnings: ["AIRLLM_PROMOTION_INSTALL_FAILED"],
    provisioning_plan: { needed: true, missing_item: "promotion install failed", candidate_runtime_checked: null, project_local_venv_recommended: true, proposed_commands: [], risks_and_assumptions: [], next_human_approval_required: true },
    evidence_path: path.join(evidenceRoot, "phase-12-skipped-airllm-environment-proof.json"),
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
  };
}

async function defaultRunner(
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

function gate(name: string, passed: boolean, message: string): AirLlmPromotionSafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
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
