import { execFile } from "child_process";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { resolveModelRole, type ModelRoleAssignment } from "../model-routing/model-role-routing";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";

const execFileAsync = promisify(execFile);

export type AirLlmCompatibilityVerdict = "ready_for_guarded_boot_probe" | "experimental_only" | "unknown" | "no_go";
export type AirLlmCompatibilityCandidateVerdict = "pass" | "fail" | "unsafe" | "skipped" | "unknown";
export type AirLlmCompatibilityCandidateKind = "install_import" | "source_install" | "diagnostic_only";

export interface AirLlmPythonRuntimeSpec {
  id: string;
  executable: string;
  expected_major_minor: string | null;
  exists: boolean;
  version: string | null;
  diagnostics: string[];
}

export interface AirLlmPackagePinSet {
  id: string;
  packages: string[];
  source_url: string | null;
  notes: string[];
}

export interface AirLlmCompatibilityCandidate {
  id: string;
  group: "A" | "B" | "C" | "D";
  kind: AirLlmCompatibilityCandidateKind;
  python: AirLlmPythonRuntimeSpec;
  venv_path: string | null;
  package_pin_set: AirLlmPackagePinSet;
  stop_on_success: boolean;
}

export interface AirLlmImportProbeResult {
  status: "passed" | "failed" | "unsafe" | "unknown" | "skipped";
  command: string[] | null;
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  timed_out: boolean;
  python_executable: string | null;
  python_version: string | null;
  installed_versions: Record<string, string | null>;
  optimum_import_resolved: boolean;
  optimum_bettertransformer_resolved: boolean;
  airllm_import_resolved: boolean;
  airllm_automodel_resolved: boolean;
  model_path_passed: boolean;
  model_instantiated: boolean;
  model_load_performed: boolean;
  inference_performed: boolean;
  serving_started: boolean;
  error_class: string | null;
  error_message: string | null;
  traceback_summary: string | null;
  gpu_memory_before: string | null;
  gpu_memory_after: string | null;
  diagnostics: string[];
}

export interface AirLlmCompatibilityCommandResult {
  name: string;
  command: string[];
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  diagnostics: string[];
}

export interface AirLlmCompatibilityCandidateResult {
  candidate_id: string;
  python_runtime_target: AirLlmPythonRuntimeSpec;
  venv_path: string | null;
  package_install_plan: string[];
  package_versions_requested: string[];
  package_versions_installed: Record<string, string | null>;
  commands: AirLlmCompatibilityCommandResult[];
  import_probe_result: AirLlmImportProbeResult;
  optimum_bettertransformer_resolved: boolean;
  airllm_automodel_resolved: boolean;
  model_path_passed: boolean;
  serving_started: boolean;
  super_model_load_performed: boolean;
  super_model_inference_performed: boolean;
  fallback_used: boolean;
  qwen_used: boolean;
  integration_performed: boolean;
  verdict: AirLlmCompatibilityCandidateVerdict;
  reason: string;
  evidence_path: string | null;
}

export interface AirLlmCompatibilitySafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface AirLlmCompatibilityMatrixResult {
  matrix_id: string;
  timestamp: string;
  repo_root: string;
  repo_commit_at_start: string | null;
  candidates: AirLlmCompatibilityCandidate[];
  candidate_results: AirLlmCompatibilityCandidateResult[];
  winner_candidate_id: string | null;
  final_verdict: AirLlmCompatibilityVerdict;
  package_freeze_for_winner: string[] | null;
  safety_gates: AirLlmCompatibilitySafetyGate[];
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  senior_role_resolution: ModelRoleAssignment;
  boot_probe_status: "disabled";
  fallback_used: false;
  airllm_serving_started: false;
  super_used: false;
  qwen_used: false;
  super_model_load_performed: false;
  super_model_inference_performed: false;
  integration_performed: false;
  matrix_gitignored: boolean;
  evidence_path: string;
  blocked_reasons: string[];
  warnings: string[];
  recommended_next_action: string;
}

export interface AirLlmCompatibilityMatrixOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  now?: () => Date;
  runner?: AirLlmCompatibilityCommandRunner;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  env?: NodeJS.ProcessEnv;
  candidates?: AirLlmCompatibilityCandidate[];
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

export type AirLlmCompatibilityCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;

const MATRIX_ROOT = ".airllm-matrix";
const OFFICIAL_AIRLLM_SOURCE_URL = "https://github.com/lyogavin/airllm.git";
const PACKAGE_NAMES = ["airllm", "optimum", "transformers", "torch", "accelerate", "safetensors"];

export async function discoverAirLlmMatrixPythonRuntimes(
  options: Pick<AirLlmCompatibilityMatrixOptions, "runner" | "env"> = {},
): Promise<AirLlmPythonRuntimeSpec[]> {
  const configured = options.env?.AIRLLM_MATRIX_PYTHON?.trim();
  const specs = [
    configured ? { id: "configured", executable: configured, expected: null } : null,
    { id: "phase10", executable: ".venv-airllm/bin/python", expected: "3.12" },
    { id: "python3", executable: "python3", expected: null },
    { id: "python3.12", executable: "python3.12", expected: "3.12" },
    { id: "python3.11", executable: "python3.11", expected: "3.11" },
    { id: "python3.10", executable: "python3.10", expected: "3.10" },
  ].filter((entry): entry is { id: string; executable: string; expected: string | null } => !!entry);
  const seen = new Set<string>();
  const runtimes: AirLlmPythonRuntimeSpec[] = [];
  for (const spec of specs) {
    if (seen.has(spec.executable)) continue;
    seen.add(spec.executable);
    runtimes.push(await runtimeSpec(spec.id, spec.executable, spec.expected, options.runner));
  }
  return runtimes;
}

export function buildAirLlmCompatibilityCandidates(input: {
  runtimes: AirLlmPythonRuntimeSpec[];
}): AirLlmCompatibilityCandidate[] {
  const runtime312 = firstRuntime(input.runtimes, "3.12") ?? firstRuntime(input.runtimes, null) ?? missingRuntime("python3.12", "3.12");
  const runtime311 = firstRuntime(input.runtimes, "3.11") ?? missingRuntime("python3.11", "3.11");
  const runtime310 = firstRuntime(input.runtimes, "3.10") ?? missingRuntime("python3.10", "3.10");
  return [
    candidate("a1", "A", runtime312, ["airllm==2.11.0", "optimum<2", "transformers<4.49"], "install_import"),
    candidate("a2", "A", runtime312, ["airllm==2.11.0", "optimum<2", "transformers<4.49", "setuptools<82", "sentencepiece"], "install_import"),
    candidate("a3", "A", runtime312, [`git+${OFFICIAL_AIRLLM_SOURCE_URL}`, "optimum<2", "transformers<4.49"], "source_install"),
    candidate("b1", "B", runtime311, ["airllm==2.11.0", "optimum<2", "transformers<4.49"], "install_import"),
    candidate("b2", "B", runtime311, ["airllm==2.11.0", "optimum<2", "transformers<4.49", "setuptools<82", "sentencepiece"], "install_import"),
    candidate("b3", "B", runtime311, [`git+${OFFICIAL_AIRLLM_SOURCE_URL}`, "optimum<2", "transformers<4.49"], "source_install"),
    candidate("c1", "C", runtime310, ["airllm==2.11.0", "optimum<2", "transformers<4.49"], "install_import"),
    candidate("c2", "C", runtime310, ["airllm==2.11.0", "optimum<2", "transformers<4.49", "setuptools<82", "sentencepiece"], "install_import"),
    candidate("c3", "C", runtime310, [`git+${OFFICIAL_AIRLLM_SOURCE_URL}`, "optimum<2", "transformers<4.49"], "source_install"),
    diagnosticCandidate("d1", "inspect installed AirLLM metadata and source files"),
    diagnosticCandidate("d2", "inspect available Optimum versions from pip metadata"),
    diagnosticCandidate("d3", "inspect whether BetterTransformer exists in candidate Optimum installs"),
    diagnosticCandidate("d4", "generate compatibility recommendation"),
  ];
}

export function validateAirLlmMatrixCommand(command: string[]): string[] {
  const serialized = command.join(" ");
  const diagnostics: string[] = [];
  if (command[0] === "sudo") diagnostics.push("AIRLLM_MATRIX_SUDO_FORBIDDEN");
  if (command[0] === "apt" || command[0] === "apt-get") diagnostics.push("AIRLLM_MATRIX_APT_FORBIDDEN");
  if (command[0] === "pip" || command[0] === "pip3") diagnostics.push("AIRLLM_MATRIX_GLOBAL_PIP_FORBIDDEN");
  if (serialized.toLowerCase().includes("qwen")) diagnostics.push("AIRLLM_MATRIX_QWEN_FORBIDDEN");
  if (serialized.includes("/mnt/large-storage/models")) diagnostics.push("AIRLLM_MATRIX_MODEL_PATH_FORBIDDEN");
  const isVenvCreate = command[1] === "-m"
    && command[2] === "venv"
    && command[3]?.startsWith(`${MATRIX_ROOT}/venv-`);
  const isMatrixPython = command[0]?.startsWith(`${MATRIX_ROOT}/venv-`) && command[0].endsWith("/bin/python");
  const isMatrixPip = isMatrixPython && command[1] === "-m" && command[2] === "pip";
  const isMatrixProbe = isMatrixPython && command[1] === "-c";
  const isNvidiaSmi = command[0] === "nvidia-smi";
  const isGitRevParse = command[0] === "git" && command[1] === "rev-parse";
  if (!isVenvCreate && !isMatrixPip && !isMatrixProbe && !isNvidiaSmi && !isGitRevParse) {
    diagnostics.push("AIRLLM_MATRIX_COMMAND_NOT_ALLOWLISTED");
  }
  return diagnostics;
}

export async function runAirLlmCompatibilityMatrix(
  options: AirLlmCompatibilityMatrixOptions = {},
): Promise<AirLlmCompatibilityMatrixResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const evidenceRoot = options.evidenceRoot ?? "evidence/airllm-compatibility-matrix";
  const matrixId = `phase-11-airllm-compatibility-matrix-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(evidenceRoot, `${matrixId}.json`);
  const runner = options.runner ?? defaultRunner;
  const preflight = await runCheckOnlyPreflight(options);
  const seniorRole = resolveModelRole("console_senior_worker", options.env);
  const repoCommit = await repoCommitAtStart(repoRoot, runner);
  const runtimes = await discoverAirLlmMatrixPythonRuntimes({ runner, env: options.env });
  const candidates = options.candidates ?? buildAirLlmCompatibilityCandidates({ runtimes });
  const candidateResults: AirLlmCompatibilityCandidateResult[] = [];
  let winner: AirLlmCompatibilityCandidateResult | null = null;

  for (const candidateItem of candidates) {
    if (winner && candidateItem.kind !== "diagnostic_only") break;
    const result = await runCandidate({ candidate: candidateItem, repoRoot, runner, env: options.env });
    candidateResults.push(result);
    if (result.verdict === "pass" && candidateItem.stop_on_success) {
      winner = result;
      break;
    }
  }

  const postflight = await runCheckOnlyPreflight(options);
  const matrixIgnored = await matrixRootIsIgnored(repoRoot);
  const gates = evaluateCompatibilitySafetyGates({
    preflightStatus: preflight.status,
    postflightStatus: postflight.status,
    seniorRole,
    matrixIgnored,
    winner,
    safetyOverrides: options.safetyOverrides,
  });
  const blockedReasons = gates
    .filter((gateItem) => gateItem.status === "failed")
    .map((gateItem) => `${gateItem.name}:${gateItem.message}`);
  const finalVerdict: AirLlmCompatibilityVerdict = blockedReasons.length > 0
    ? "no_go"
    : winner
      ? winner.package_install_plan.some((entry) => entry.startsWith("git+")) ? "experimental_only" : "ready_for_guarded_boot_probe"
      : candidateResults.some((result) => result.verdict === "unknown")
        ? "unknown"
        : "no_go";
  const result: AirLlmCompatibilityMatrixResult = {
    matrix_id: matrixId,
    timestamp,
    repo_root: repoRoot,
    repo_commit_at_start: repoCommit,
    candidates,
    candidate_results: candidateResults,
    winner_candidate_id: winner?.candidate_id ?? null,
    final_verdict: finalVerdict,
    package_freeze_for_winner: winner?.commands.find((command) => command.name === "package_freeze")?.stdout_summary?.split(/\r?\n/) ?? null,
    safety_gates: gates,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    senior_role_resolution: seniorRole,
    boot_probe_status: "disabled",
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
    matrix_gitignored: matrixIgnored,
    evidence_path: evidencePath,
    blocked_reasons: blockedReasons,
    warnings: candidateResults.flatMap((resultItem) => resultItem.import_probe_result.diagnostics),
    recommended_next_action: recommendation(finalVerdict, winner, candidateResults),
  };
  await writeJson(evidencePath, result);
  return result;
}

async function runCandidate(input: {
  candidate: AirLlmCompatibilityCandidate;
  repoRoot: string;
  runner: AirLlmCompatibilityCommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<AirLlmCompatibilityCandidateResult> {
  const item = input.candidate;
  if (item.kind === "diagnostic_only") {
    return diagnosticResult(item);
  }
  if (!item.python.exists) {
    return skippedCandidate(item, "PYTHON_RUNTIME_MISSING");
  }
  const commands: AirLlmCompatibilityCommandResult[] = [];
  const venvPath = item.venv_path ?? `${MATRIX_ROOT}/venv-${item.id}`;
  const venvPython = `${venvPath}/bin/python`;
  const create = await runMatrixCommand("create_candidate_venv", [item.python.executable, "-m", "venv", venvPath], input);
  commands.push(create);
  if (create.exit_code !== 0) return failedCandidate(item, commands, "CANDIDATE_VENV_CREATE_FAILED");
  const tooling = await runMatrixCommand("upgrade_candidate_pip_tooling", [venvPython, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], input);
  commands.push(tooling);
  if (tooling.exit_code !== 0) return failedCandidate(item, commands, "CANDIDATE_PIP_TOOLING_FAILED");
  const install = await runMatrixCommand("install_candidate_packages", [venvPython, "-m", "pip", "install", ...item.package_pin_set.packages], input, 900_000);
  commands.push(install);
  if (install.exit_code !== 0) return failedCandidate(item, commands, "CANDIDATE_PACKAGE_INSTALL_FAILED");
  const freeze = await runMatrixCommand("package_freeze", [venvPython, "-m", "pip", "freeze"], input);
  commands.push(freeze);
  const probe = await runAirLlmImportProbe({
    pythonExecutable: venvPython,
    repoRoot: input.repoRoot,
    runner: input.runner,
    env: input.env,
  });
  const installed = probe.installed_versions;
  const verdict: AirLlmCompatibilityCandidateVerdict = probe.status === "passed"
    ? "pass"
    : probe.status === "unsafe"
      ? "unsafe"
      : probe.status === "unknown"
        ? "unknown"
        : "fail";
  return {
    candidate_id: item.id,
    python_runtime_target: item.python,
    venv_path: venvPath,
    package_install_plan: item.package_pin_set.packages,
    package_versions_requested: item.package_pin_set.packages,
    package_versions_installed: installed,
    commands,
    import_probe_result: probe,
    optimum_bettertransformer_resolved: probe.optimum_bettertransformer_resolved,
    airllm_automodel_resolved: probe.airllm_automodel_resolved,
    model_path_passed: probe.model_path_passed,
    serving_started: probe.serving_started,
    super_model_load_performed: probe.model_load_performed,
    super_model_inference_performed: probe.inference_performed,
    fallback_used: false,
    qwen_used: false,
    integration_performed: false,
    verdict,
    reason: verdict === "pass" ? "IMPORT_ONLY_PROBE_SUCCEEDED" : ((probe.error_message ?? probe.diagnostics.join(";")) || "IMPORT_ONLY_PROBE_FAILED"),
    evidence_path: null,
  };
}

export async function runAirLlmImportProbe(input: {
  pythonExecutable: string;
  repoRoot: string;
  runner?: AirLlmCompatibilityCommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<AirLlmImportProbeResult> {
  const runner = input.runner ?? defaultRunner;
  const before = await safeGpuMemory(runner, input.repoRoot);
  const script = [
    "import importlib, importlib.metadata, json, sys, traceback",
    `packages = ${JSON.stringify(PACKAGE_NAMES)}`,
    "data = {'python_executable': sys.executable, 'python_version': sys.version.split()[0], 'installed_versions': {}, 'optimum_import_resolved': False, 'optimum_bettertransformer_resolved': False, 'airllm_import_resolved': False, 'airllm_automodel_resolved': False, 'model_path_passed': False, 'model_instantiated': False, 'model_load_performed': False, 'inference_performed': False, 'serving_started': False, 'error_class': None, 'error_message': None, 'traceback_summary': None}",
    "for package in packages:",
    "    try:",
    "        data['installed_versions'][package] = importlib.metadata.version(package)",
    "    except Exception:",
    "        data['installed_versions'][package] = None",
    "try:",
    "    import optimum",
    "    data['optimum_import_resolved'] = True",
    "    import optimum.bettertransformer",
    "    data['optimum_bettertransformer_resolved'] = True",
    "    import airllm",
    "    data['airllm_import_resolved'] = True",
    "    from airllm import AutoModel",
    "    data['airllm_automodel_resolved'] = True",
    "except Exception as exc:",
    "    data['error_class'] = exc.__class__.__name__",
    "    data['error_message'] = str(exc)",
    "    data['traceback_summary'] = traceback.format_exc()[-2000:]",
    "    print(json.dumps(data))",
    "    raise SystemExit(1)",
    "print(json.dumps(data))",
  ].join("\n");
  const command = [input.pythonExecutable, "-c", script];
  const validation = validateAirLlmMatrixCommand(command);
  if (validation.length > 0) {
    return emptyProbe("unsafe", command, validation);
  }
  const result = await runner(input.pythonExecutable, ["-c", script], { cwd: input.repoRoot, timeoutMs: 20_000, env: input.env });
  const after = await safeGpuMemory(runner, input.repoRoot);
  const parsed = parseJson(result.stdout);
  const unsafe = parsed?.model_path_passed === true
    || parsed?.model_instantiated === true
    || parsed?.model_load_performed === true
    || parsed?.inference_performed === true
    || parsed?.serving_started === true;
  return {
    status: unsafe ? "unsafe" : result.exitCode === 0 ? "passed" : "failed",
    command: [input.pythonExecutable, "-c", "<airllm-compatibility-import-probe>"],
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    timed_out: result.timedOut === true,
    python_executable: stringOrNull(parsed?.python_executable),
    python_version: stringOrNull(parsed?.python_version),
    installed_versions: objectOfStrings(parsed?.installed_versions),
    optimum_import_resolved: parsed?.optimum_import_resolved === true,
    optimum_bettertransformer_resolved: parsed?.optimum_bettertransformer_resolved === true,
    airllm_import_resolved: parsed?.airllm_import_resolved === true,
    airllm_automodel_resolved: parsed?.airllm_automodel_resolved === true,
    model_path_passed: parsed?.model_path_passed === true,
    model_instantiated: parsed?.model_instantiated === true,
    model_load_performed: parsed?.model_load_performed === true,
    inference_performed: parsed?.inference_performed === true,
    serving_started: parsed?.serving_started === true,
    error_class: stringOrNull(parsed?.error_class),
    error_message: stringOrNull(parsed?.error_message),
    traceback_summary: stringOrNull(parsed?.traceback_summary),
    gpu_memory_before: before,
    gpu_memory_after: after,
    diagnostics: result.exitCode === 0 ? [] : [`AIRLLM_MATRIX_IMPORT_PROBE_FAILED:${result.exitCode}`],
  };
}

async function runMatrixCommand(
  name: string,
  command: string[],
  input: { repoRoot: string; runner: AirLlmCompatibilityCommandRunner; env?: NodeJS.ProcessEnv },
  timeoutMs = 180_000,
): Promise<AirLlmCompatibilityCommandResult> {
  const diagnostics = validateAirLlmMatrixCommand(command);
  if (diagnostics.length > 0) {
    return { name, command, exit_code: null, stdout_summary: null, stderr_summary: null, diagnostics };
  }
  const [bin, ...args] = command;
  const result = await input.runner(bin, args, { cwd: input.repoRoot, timeoutMs, env: input.env });
  return {
    name,
    command,
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    diagnostics: result.exitCode === 0 ? [] : [`AIRLLM_MATRIX_COMMAND_FAILED:${name}:${result.exitCode}`],
  };
}

function evaluateCompatibilitySafetyGates(input: {
  preflightStatus: string | null;
  postflightStatus: string | null;
  seniorRole: ModelRoleAssignment;
  matrixIgnored: boolean;
  winner: AirLlmCompatibilityCandidateResult | null;
  safetyOverrides?: AirLlmCompatibilityMatrixOptions["safetyOverrides"];
}): AirLlmCompatibilitySafetyGate[] {
  const safety = input.safetyOverrides ?? {};
  return [
    gate("nano_roles_primary_and_healthy", input.preflightStatus === "healthy" && input.postflightStatus === "healthy", "Nano runtime remained healthy before and after matrix proof."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("boot_probe_disabled", true, "Boot probe remains disabled."),
    gate("matrix_root_gitignored", input.matrixIgnored, ".airllm-matrix is ignored by git."),
    gate("no_model_path_passed", input.winner ? !input.winner.model_path_passed : true, "Import probe did not receive a Super model path."),
    gate("no_super_model_load", safety.superModelLoaded !== true && input.winner?.super_model_load_performed !== true, "No Super model load occurred."),
    gate("no_senior_inference", safety.seniorInferencePerformed !== true && input.winner?.super_model_inference_performed !== true, "No senior inference occurred."),
    gate("no_airllm_serving", safety.airllmServingStarted !== true && input.winner?.serving_started !== true, "No AirLLM serving process was started."),
    gate("qwen_not_used", safety.qwenUsed !== true && input.winner?.qwen_used !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true && input.winner?.fallback_used !== true, "No fallback model was used."),
    gate("no_integration", safety.integrationPerformed !== true && input.winner?.integration_performed !== true, "No integration occurred."),
    gate("no_uncontrolled_process_operations", safety.uncontrolledProcessOperation !== true, "No uncontrolled process operations occurred."),
  ];
}

function candidate(
  id: string,
  group: "A" | "B" | "C",
  python: AirLlmPythonRuntimeSpec,
  packages: string[],
  kind: "install_import" | "source_install",
): AirLlmCompatibilityCandidate {
  return {
    id,
    group,
    kind,
    python,
    venv_path: `${MATRIX_ROOT}/venv-${id}`,
    package_pin_set: {
      id: `${id}-pins`,
      packages,
      source_url: kind === "source_install" ? OFFICIAL_AIRLLM_SOURCE_URL : null,
      notes: kind === "source_install" ? ["Official AirLLM GitHub source verified from PyPI/homepage."] : [],
    },
    stop_on_success: true,
  };
}

function diagnosticCandidate(id: string, note: string): AirLlmCompatibilityCandidate {
  return {
    id,
    group: "D",
    kind: "diagnostic_only",
    python: missingRuntime("diagnostic", null),
    venv_path: null,
    package_pin_set: { id: `${id}-diagnostic`, packages: [], source_url: null, notes: [note] },
    stop_on_success: false,
  };
}

function diagnosticResult(item: AirLlmCompatibilityCandidate): AirLlmCompatibilityCandidateResult {
  return {
    candidate_id: item.id,
    python_runtime_target: item.python,
    venv_path: null,
    package_install_plan: [],
    package_versions_requested: [],
    package_versions_installed: {},
    commands: [],
    import_probe_result: emptyProbe("skipped", null, ["AIRLLM_MATRIX_DIAGNOSTIC_RECORDED_ONLY"]),
    optimum_bettertransformer_resolved: false,
    airllm_automodel_resolved: false,
    model_path_passed: false,
    serving_started: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    fallback_used: false,
    qwen_used: false,
    integration_performed: false,
    verdict: "skipped",
    reason: item.package_pin_set.notes[0] ?? "DIAGNOSTIC_ONLY",
    evidence_path: null,
  };
}

function skippedCandidate(item: AirLlmCompatibilityCandidate, reason: string): AirLlmCompatibilityCandidateResult {
  return {
    candidate_id: item.id,
    python_runtime_target: item.python,
    venv_path: item.venv_path,
    package_install_plan: item.package_pin_set.packages,
    package_versions_requested: item.package_pin_set.packages,
    package_versions_installed: {},
    commands: [],
    import_probe_result: emptyProbe("skipped", null, [reason]),
    optimum_bettertransformer_resolved: false,
    airllm_automodel_resolved: false,
    model_path_passed: false,
    serving_started: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    fallback_used: false,
    qwen_used: false,
    integration_performed: false,
    verdict: "skipped",
    reason,
    evidence_path: null,
  };
}

function failedCandidate(
  item: AirLlmCompatibilityCandidate,
  commands: AirLlmCompatibilityCommandResult[],
  reason: string,
): AirLlmCompatibilityCandidateResult {
  return {
    candidate_id: item.id,
    python_runtime_target: item.python,
    venv_path: item.venv_path,
    package_install_plan: item.package_pin_set.packages,
    package_versions_requested: item.package_pin_set.packages,
    package_versions_installed: {},
    commands,
    import_probe_result: emptyProbe("skipped", null, [reason]),
    optimum_bettertransformer_resolved: false,
    airllm_automodel_resolved: false,
    model_path_passed: false,
    serving_started: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    fallback_used: false,
    qwen_used: false,
    integration_performed: false,
    verdict: "fail",
    reason,
    evidence_path: null,
  };
}

function emptyProbe(status: AirLlmImportProbeResult["status"], command: string[] | null, diagnostics: string[]): AirLlmImportProbeResult {
  return {
    status,
    command,
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

function firstRuntime(runtimes: AirLlmPythonRuntimeSpec[], expected: string | null): AirLlmPythonRuntimeSpec | null {
  if (expected) return runtimes.find((runtime) => runtime.expected_major_minor === expected && runtime.exists) ?? null;
  return runtimes.find((runtime) => runtime.exists && (runtime.version?.includes("Python 3.12") || runtime.version?.includes("3.12"))) ?? null;
}

function missingRuntime(executable: string, expected: string | null): AirLlmPythonRuntimeSpec {
  return { id: executable, executable, expected_major_minor: expected, exists: false, version: null, diagnostics: ["AIRLLM_MATRIX_PYTHON_RUNTIME_NOT_AVAILABLE"] };
}

async function runtimeSpec(
  id: string,
  executable: string,
  expected: string | null,
  runner: AirLlmCompatibilityCommandRunner = defaultRunner,
): Promise<AirLlmPythonRuntimeSpec> {
  const exists = await commandExists(executable, runner);
  if (!exists) return missingRuntime(executable, expected);
  const version = await runner(executable, ["--version"]);
  return {
    id,
    executable,
    expected_major_minor: expected,
    exists: true,
    version: (version.stdout || version.stderr).trim() || null,
    diagnostics: version.exitCode === 0 ? [] : [`AIRLLM_MATRIX_PYTHON_VERSION_FAILED:${version.exitCode}`],
  };
}

async function commandExists(executable: string, runner: AirLlmCompatibilityCommandRunner): Promise<boolean> {
  if (executable.includes("/") || executable.startsWith(".")) {
    try {
      await access(executable);
      const entry = await stat(executable);
      return entry.isFile();
    } catch {
      return false;
    }
  }
  const result = await runner(executable, ["--version"]);
  return result.exitCode === 0;
}

async function safeGpuMemory(runner: AirLlmCompatibilityCommandRunner, cwd: string): Promise<string | null> {
  const command = ["nvidia-smi", "--query-gpu=index,memory.total,memory.free,memory.used", "--format=csv,noheader"];
  if (validateAirLlmMatrixCommand(command).length > 0) return null;
  try {
    const result = await runner(command[0], command.slice(1), { cwd, timeoutMs: 5_000 });
    return result.exitCode === 0 ? summarize(result.stdout) : null;
  } catch {
    return null;
  }
}

async function repoCommitAtStart(repoRoot: string, runner: AirLlmCompatibilityCommandRunner): Promise<string | null> {
  const result = await runner("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeoutMs: 5_000 });
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

async function matrixRootIsIgnored(repoRoot: string): Promise<boolean> {
  try {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    return gitignore.split(/\r?\n/).some((line) => line.trim() === "/.airllm-matrix/" || line.trim() === ".airllm-matrix/");
  } catch {
    return false;
  }
}

async function runCheckOnlyPreflight(options: AirLlmCompatibilityMatrixOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function gate(name: string, passed: boolean, message: string): AirLlmCompatibilitySafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
}

function recommendation(
  verdict: AirLlmCompatibilityVerdict,
  winner: AirLlmCompatibilityCandidateResult | null,
  results: AirLlmCompatibilityCandidateResult[],
): string {
  if (winner && verdict === "ready_for_guarded_boot_probe") {
    return `Promote ${winner.candidate_id} into a locked requirements-airllm candidate, then run a future guarded boot probe phase.`;
  }
  if (winner && verdict === "experimental_only") {
    return `Review ${winner.candidate_id} source-install provenance before promoting any runtime.`;
  }
  const reasons = Array.from(new Set(results.filter((item) => item.verdict === "fail").map((item) => item.reason)));
  return `No approved candidate imported cleanly. Review AirLLM/Optimum/Transformers compatibility or choose a different senior-runtime strategy. Reasons: ${reasons.join("; ") || "none"}`;
}

async function defaultRunner(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const maybeError = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return {
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
      timedOut: maybeError.killed === true,
    };
  }
}

function objectOfStrings(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, stringOrNull(entry)]));
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value.trim());
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    for (const line of value.split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
      } catch {
        continue;
      }
    }
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
