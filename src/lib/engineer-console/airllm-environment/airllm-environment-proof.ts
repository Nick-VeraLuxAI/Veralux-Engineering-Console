import { execFile } from "child_process";
import { access, mkdir, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  resolveModelRole,
  type ModelRoleAssignment,
} from "../model-routing/model-role-routing";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";
import {
  auditHardwareForSuper,
  auditSuperModelArtifacts,
  createSuperBootProbePlan,
  parseAirLlmUri,
  type SuperAuditCommandRunner,
  type SuperBootProbePlan,
  type SuperCheckStatus,
  type SuperHardwareSnapshot,
  type SuperModelArtifactCheck,
} from "../super-compatibility/super-compatibility-audit";

const execFileAsync = promisify(execFile);

export type AirLlmEnvironmentVerdict = "ready_for_guarded_boot_probe" | "unknown" | "no_go";
export type AirLlmProofMode = "import_only_no_model_load";
export type AirLlmImportStatus = "passed" | "failed" | "unknown" | "skipped_unsafe";

export interface AirLlmEnvironmentProofConfig {
  seniorRoleId: string;
  proofMode: AirLlmProofMode;
  evidenceRoot: string;
}

export interface AirLlmPythonRuntimeCandidate {
  id: string;
  executable: string;
  source: "env" | "project_venv" | "path";
  exists: boolean;
  version: string | null;
  diagnostics: string[];
}

export interface AirLlmImportCheck {
  status: AirLlmImportStatus;
  candidate: AirLlmPythonRuntimeCandidate | null;
  command: string | null;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  package_found: boolean;
  import_succeeded: boolean;
  version: string | null;
  module_path: string | null;
  diagnostics: string[];
}

export interface AirLlmDependencySnapshot {
  status: SuperCheckStatus;
  python_executable: string | null;
  python_version: string | null;
  airllm_distribution_version: string | null;
  torch_version: string | null;
  torch_cuda_available: boolean | null;
  torch_cuda_version: string | null;
  nvidia_smi_summary: string | null;
  safe_environment: Record<string, string | null>;
  diagnostics: string[];
}

export interface AirLlmSafetyGate {
  name: string;
  status: SuperCheckStatus;
  required: boolean;
  message: string;
}

export interface AirLlmProvisioningPlan {
  needed: boolean;
  missing_item: string | null;
  candidate_runtime_checked: string | null;
  project_local_venv_recommended: boolean;
  proposed_commands: string[];
  risks_and_assumptions: string[];
  next_human_approval_required: boolean;
}

export interface AirLlmEnvironmentProofResult {
  proof_id: string;
  timestamp: string;
  senior_role_id: string;
  senior_role_resolution: ModelRoleAssignment;
  configured_provider: string | null;
  configured_model_path: string | null;
  expected_model: string | null;
  proof_mode: AirLlmProofMode;
  python_runtime_candidates: AirLlmPythonRuntimeCandidate[];
  selected_runtime_path: string | null;
  airllm_import_check: AirLlmImportCheck;
  dependency_snapshot: AirLlmDependencySnapshot;
  model_artifact_check: SuperModelArtifactCheck;
  hardware_snapshot: SuperHardwareSnapshot;
  safety_gates: AirLlmSafetyGate[];
  boot_probe_plan: SuperBootProbePlan;
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  final_verdict: AirLlmEnvironmentVerdict;
  blocked_reasons: string[];
  warnings: string[];
  provisioning_plan: AirLlmProvisioningPlan;
  evidence_path: string;
  fallback_used: false;
  airllm_serving_started: false;
  super_used: false;
  qwen_used: false;
  super_model_load_performed: false;
  super_model_inference_performed: false;
  integration_performed: false;
}

export interface AirLlmEnvironmentProofOptions {
  env?: NodeJS.ProcessEnv;
  evidenceRoot?: string;
  now?: () => Date;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  commandRunner?: SuperAuditCommandRunner;
  candidatePaths?: string[];
  includeProjectVenvCandidates?: boolean;
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

export const DEFAULT_AIRLLM_ENVIRONMENT_PROOF_CONFIG: AirLlmEnvironmentProofConfig = {
  seniorRoleId: "console_senior_worker",
  proofMode: "import_only_no_model_load",
  evidenceRoot: "evidence/airllm-environment",
};

export async function discoverAirLlmPythonRuntimes(
  options: AirLlmEnvironmentProofOptions = {},
): Promise<AirLlmPythonRuntimeCandidate[]> {
  const env = options.env ?? process.env;
  const candidateSpecs = [
    env.AIRLLM_PYTHON ? { executable: env.AIRLLM_PYTHON, source: "env" as const } : null,
    ...(options.includeProjectVenvCandidates === false ? [] : projectVenvCandidates().map((executable) => ({ executable, source: "project_venv" as const }))),
    ...(options.candidatePaths ?? []).map((executable) => ({ executable, source: "env" as const })),
    { executable: "python3", source: "path" as const },
    { executable: "python", source: "path" as const },
  ].filter((entry): entry is { executable: string; source: AirLlmPythonRuntimeCandidate["source"] } => !!entry);
  const seen = new Set<string>();
  const candidates: AirLlmPythonRuntimeCandidate[] = [];
  for (const spec of candidateSpecs) {
    if (seen.has(spec.executable)) continue;
    seen.add(spec.executable);
    candidates.push(await runtimeCandidate(spec.executable, spec.source, options.commandRunner));
  }
  return candidates;
}

export async function checkAirLlmImportability(input: {
  candidates: AirLlmPythonRuntimeCandidate[];
  commandRunner?: SuperAuditCommandRunner;
}): Promise<AirLlmImportCheck> {
  const runner = input.commandRunner ?? defaultCommandRunner;
  for (const candidate of input.candidates.filter((entry) => entry.exists)) {
    const script = [
      "import importlib, importlib.metadata, json",
      "spec = importlib.util.find_spec('airllm') if hasattr(importlib, 'util') else None",
      "if spec is None:",
      "    print(json.dumps({'package_found': False, 'import_succeeded': False, 'version': None, 'module_path': None}))",
      "    raise SystemExit(2)",
      "module = importlib.import_module('airllm')",
      "version = None",
      "try:",
      "    version = importlib.metadata.version('airllm')",
      "except Exception:",
      "    version = getattr(module, '__version__', None)",
      "print(json.dumps({'package_found': True, 'import_succeeded': True, 'version': version, 'module_path': getattr(module, '__file__', None)}))",
    ].join("\n");
    const result = await runner(candidate.executable, ["-c", script]);
    const parsed = parseImportJson(result.stdout);
    if (result.exitCode === 0 && parsed?.import_succeeded === true) {
      return {
        status: "passed",
        candidate,
        command: `${candidate.executable} -c <airllm-import-only-check>`,
        exit_code: result.exitCode,
        stdout: result.stdout.trim() || null,
        stderr: result.stderr.trim() || null,
        package_found: true,
        import_succeeded: true,
        version: stringOrNull(parsed.version),
        module_path: stringOrNull(parsed.module_path),
        diagnostics: [],
      };
    }
    if (result.exitCode === 2 || parsed?.package_found === false) {
      continue;
    }
    return {
      status: "failed",
      candidate,
      command: `${candidate.executable} -c <airllm-import-only-check>`,
      exit_code: result.exitCode,
      stdout: result.stdout.trim() || null,
      stderr: result.stderr.trim() || null,
      package_found: parsed?.package_found === true,
      import_succeeded: false,
      version: stringOrNull(parsed?.version),
      module_path: stringOrNull(parsed?.module_path),
      diagnostics: [`AIRLLM_IMPORT_CHECK_FAILED:${result.exitCode}`],
    };
  }
  return {
    status: "unknown",
    candidate: null,
    command: null,
    exit_code: null,
    stdout: null,
    stderr: null,
    package_found: false,
    import_succeeded: false,
    version: null,
    module_path: null,
    diagnostics: ["AIRLLM_IMPORT_NOT_DISCOVERABLE_IN_CANDIDATE_RUNTIMES"],
  };
}

export async function captureAirLlmDependencySnapshot(input: {
  importCheck: AirLlmImportCheck;
  commandRunner?: SuperAuditCommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<AirLlmDependencySnapshot> {
  const candidate = input.importCheck.candidate;
  const diagnostics: string[] = [];
  let pythonVersion: string | null = candidate?.version ?? null;
  let airllmVersion: string | null = input.importCheck.version;
  let torchVersion: string | null = null;
  let torchCudaAvailable: boolean | null = null;
  let torchCudaVersion: string | null = null;
  const runner = input.commandRunner ?? defaultCommandRunner;

  if (candidate) {
    const script = [
      "import json, sys, importlib.util, importlib.metadata",
      "data = {'python_version': sys.version.split()[0], 'airllm_version': None, 'torch_version': None, 'torch_cuda_available': None, 'torch_cuda_version': None}",
      "try:",
      "    data['airllm_version'] = importlib.metadata.version('airllm')",
      "except Exception:",
      "    pass",
      "if importlib.util.find_spec('torch'):",
      "    import torch",
      "    data['torch_version'] = getattr(torch, '__version__', None)",
      "    data['torch_cuda_available'] = bool(torch.cuda.is_available())",
      "    data['torch_cuda_version'] = getattr(torch.version, 'cuda', None)",
      "print(json.dumps(data))",
    ].join("\n");
    const result = await runner(candidate.executable, ["-c", script]);
    if (result.exitCode === 0) {
      const parsed = parseJson(result.stdout);
      pythonVersion = stringOrNull(parsed?.python_version) ?? pythonVersion;
      airllmVersion = stringOrNull(parsed?.airllm_version) ?? airllmVersion;
      torchVersion = stringOrNull(parsed?.torch_version);
      torchCudaAvailable = typeof parsed?.torch_cuda_available === "boolean" ? parsed.torch_cuda_available : null;
      torchCudaVersion = stringOrNull(parsed?.torch_cuda_version);
    } else {
      diagnostics.push(`AIRLLM_DEPENDENCY_SNAPSHOT_FAILED:${result.exitCode}`);
    }
  } else {
    diagnostics.push("AIRLLM_DEPENDENCY_SNAPSHOT_SKIPPED_NO_RUNTIME");
  }

  let nvidiaSmiSummary: string | null = null;
  try {
    const result = await runner("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.free,memory.used", "--format=csv,noheader"]);
    if (result.exitCode === 0) {
      nvidiaSmiSummary = result.stdout.trim() || null;
    } else {
      diagnostics.push(`AIRLLM_NVIDIA_SMI_FAILED:${result.exitCode}`);
    }
  } catch (error) {
    diagnostics.push(error instanceof Error ? `AIRLLM_NVIDIA_SMI_UNAVAILABLE:${error.message}` : "AIRLLM_NVIDIA_SMI_UNAVAILABLE");
  }

  return {
    status: input.importCheck.status === "passed" && diagnostics.length === 0 ? "passed" : "unknown",
    python_executable: candidate?.executable ?? null,
    python_version: pythonVersion,
    airllm_distribution_version: airllmVersion,
    torch_version: torchVersion,
    torch_cuda_available: torchCudaAvailable,
    torch_cuda_version: torchCudaVersion,
    nvidia_smi_summary: nvidiaSmiSummary,
    safe_environment: safeEnvironmentSnapshot(input.env ?? process.env),
    diagnostics,
  };
}

export function evaluateAirLlmEnvironmentGates(input: {
  seniorRole: ModelRoleAssignment;
  importCheck: AirLlmImportCheck;
  dependencySnapshot: AirLlmDependencySnapshot;
  artifactCheck: SuperModelArtifactCheck;
  hardwareSnapshot: SuperHardwareSnapshot;
  preflightRuntimeStatus: string | null;
  postflightRuntimeStatus: string | null;
  safetyOverrides?: AirLlmEnvironmentProofOptions["safetyOverrides"];
}): { gates: AirLlmSafetyGate[]; verdict: AirLlmEnvironmentVerdict; blockedReasons: string[]; warnings: string[] } {
  const safety = input.safetyOverrides ?? {};
  const gates = [
    gate("nano_roles_primary_and_healthy", input.preflightRuntimeStatus === "healthy" && input.postflightRuntimeStatus === "healthy", "Nano runtime remained healthy before and after import proof."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("proof_mode_import_only", true, "Proof mode is import_only_no_model_load."),
    gate("no_super_model_load", safety.superModelLoaded !== true, "No Super model load occurred."),
    gate("no_senior_inference", safety.seniorInferencePerformed !== true, "No senior inference occurred."),
    gate("no_airllm_serving", safety.airllmServingStarted !== true, "No AirLLM serving process was started."),
    gate("qwen_not_used", safety.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true, "No fallback model was used."),
    gate("no_integration", safety.integrationPerformed !== true, "No integration occurred."),
    gate("boot_probe_disabled", true, "Boot probe remains disabled."),
    gate("no_uncontrolled_process_operations", safety.uncontrolledProcessOperation !== true, "No uncontrolled process operations occurred."),
    statusGate("airllm_import_discovery", input.importCheck.status === "passed" ? "passed" : input.importCheck.status === "failed" ? "failed" : "unknown", "AirLLM import/package discovery is proven or clearly unknown."),
    statusGate("selected_runtime_captured", input.importCheck.status === "passed" && input.importCheck.candidate?.executable ? "passed" : input.importCheck.status === "failed" ? "failed" : "unknown", "Selected runtime path is captured when proven."),
    gate("super_artifacts_still_present", input.artifactCheck.status === "passed", "Super artifacts remain discoverable without loading."),
    gate("hardware_snapshot_captured", input.hardwareSnapshot.status !== "failed", "Hardware snapshot captured or safely degraded."),
  ];
  const blockedReasons = gates
    .filter((item) => item.required && item.status === "failed")
    .map((item) => `${item.name}:${item.message}`);
  const warnings = [
    ...gates.filter((item) => item.status === "unknown").map((item) => `${item.name}:${item.message}`),
    ...input.importCheck.diagnostics,
    ...input.dependencySnapshot.diagnostics,
    ...input.hardwareSnapshot.diagnostics,
  ];
  const safetyFailure = gates.some((item) => [
    "nano_roles_primary_and_healthy",
    "senior_role_blocked_unproven",
    "no_super_model_load",
    "no_senior_inference",
    "no_airllm_serving",
    "qwen_not_used",
    "fallback_not_used",
    "no_integration",
    "no_uncontrolled_process_operations",
  ].includes(item.name) && item.status === "failed");
  const verdict: AirLlmEnvironmentVerdict = safetyFailure || input.artifactCheck.status === "failed" || input.importCheck.status === "failed"
    ? "no_go"
    : input.importCheck.status === "passed"
      && input.dependencySnapshot.status === "passed"
      && input.artifactCheck.status === "passed"
      && input.hardwareSnapshot.status === "passed"
      ? "ready_for_guarded_boot_probe"
      : "unknown";
  return { gates, verdict, blockedReasons, warnings };
}

export function createAirLlmProvisioningPlan(input: {
  importCheck: AirLlmImportCheck;
  candidates: AirLlmPythonRuntimeCandidate[];
}): AirLlmProvisioningPlan {
  const checked = input.candidates.map((candidate) => candidate.executable).join(", ") || null;
  if (input.importCheck.status === "passed") {
    return {
      needed: false,
      missing_item: null,
      candidate_runtime_checked: input.importCheck.candidate?.executable ?? checked,
      project_local_venv_recommended: false,
      proposed_commands: [],
      risks_and_assumptions: [],
      next_human_approval_required: false,
    };
  }
  return {
    needed: true,
    missing_item: "airllm Python package/import",
    candidate_runtime_checked: checked,
    project_local_venv_recommended: true,
    proposed_commands: [
      "python3 -m venv .venv-airllm",
      ".venv-airllm/bin/python -m pip install --upgrade pip",
      ".venv-airllm/bin/python -m pip install airllm",
      "AIRLLM_PYTHON=.venv-airllm/bin/python npx tsx scripts/runtime/airllm-environment-proof.ts --evidence-root evidence/airllm-environment --import-only",
    ],
    risks_and_assumptions: [
      "Commands are recommendations only and were not executed.",
      "Package/version choice needs human approval before provisioning.",
      "Import proof still does not load Super or run inference.",
    ],
    next_human_approval_required: true,
  };
}

export async function runAirLlmEnvironmentProof(
  options: AirLlmEnvironmentProofOptions = {},
): Promise<AirLlmEnvironmentProofResult> {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const config = {
    ...DEFAULT_AIRLLM_ENVIRONMENT_PROOF_CONFIG,
    evidenceRoot: options.evidenceRoot ?? DEFAULT_AIRLLM_ENVIRONMENT_PROOF_CONFIG.evidenceRoot,
  };
  const proofId = `phase-9-airllm-environment-proof-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(config.evidenceRoot, `${proofId}.json`);
  const preflight = await runCheckOnlyPreflight(options);
  const seniorRole = resolveModelRole(config.seniorRoleId, options.env);
  const parsedUri = parseAirLlmUri(seniorRole.endpoint);
  const candidates = await discoverAirLlmPythonRuntimes(options);
  const importCheck = await checkAirLlmImportability({
    candidates,
    commandRunner: options.commandRunner,
  });
  const dependencySnapshot = await captureAirLlmDependencySnapshot({
    importCheck,
    commandRunner: options.commandRunner,
    env: options.env,
  });
  const artifactCheck = await auditSuperModelArtifacts({
    parsedUri,
    expectedModel: seniorRole.model,
  });
  const hardwareSnapshot = await auditHardwareForSuper({
    modelPath: parsedUri.model_path,
    runner: options.commandRunner,
  });
  const postflight = await runCheckOnlyPreflight(options);
  const bootProbePlan = createSuperBootProbePlan({
    mode: "disabled",
    seniorRole,
    nanoPreflightStatus: preflight.status,
  });
  const gateEvaluation = evaluateAirLlmEnvironmentGates({
    seniorRole,
    importCheck,
    dependencySnapshot,
    artifactCheck,
    hardwareSnapshot,
    preflightRuntimeStatus: preflight.status,
    postflightRuntimeStatus: postflight.status,
    safetyOverrides: options.safetyOverrides,
  });
  const provisioningPlan = createAirLlmProvisioningPlan({
    importCheck,
    candidates,
  });
  const result: AirLlmEnvironmentProofResult = {
    proof_id: proofId,
    timestamp,
    senior_role_id: seniorRole.roleId,
    senior_role_resolution: seniorRole,
    configured_provider: seniorRole.provider,
    configured_model_path: parsedUri.model_path,
    expected_model: seniorRole.model,
    proof_mode: config.proofMode,
    python_runtime_candidates: candidates,
    selected_runtime_path: importCheck.status === "passed" ? importCheck.candidate?.executable ?? null : null,
    airllm_import_check: importCheck,
    dependency_snapshot: dependencySnapshot,
    model_artifact_check: artifactCheck,
    hardware_snapshot: hardwareSnapshot,
    safety_gates: gateEvaluation.gates,
    boot_probe_plan: bootProbePlan,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    final_verdict: gateEvaluation.verdict,
    blocked_reasons: gateEvaluation.blockedReasons,
    warnings: gateEvaluation.warnings,
    provisioning_plan: provisioningPlan,
    evidence_path: evidencePath,
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
  };
  await writeJson(evidencePath, result);
  return result;
}

async function runtimeCandidate(
  executable: string,
  source: AirLlmPythonRuntimeCandidate["source"],
  runner: SuperAuditCommandRunner = defaultCommandRunner,
): Promise<AirLlmPythonRuntimeCandidate> {
  const exists = await commandExists(executable, runner);
  if (!exists) {
    return {
      id: `${source}:${executable}`,
      executable,
      source,
      exists: false,
      version: null,
      diagnostics: ["AIRLLM_PYTHON_RUNTIME_NOT_AVAILABLE"],
    };
  }
  const version = await runner(executable, ["--version"]);
  return {
    id: `${source}:${executable}`,
    executable,
    source,
    exists: true,
    version: (version.stdout || version.stderr).trim() || null,
    diagnostics: version.exitCode === 0 ? [] : [`AIRLLM_PYTHON_VERSION_FAILED:${version.exitCode}`],
  };
}

async function commandExists(executable: string, runner: SuperAuditCommandRunner): Promise<boolean> {
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

function projectVenvCandidates(): string[] {
  return [
    ".venv-airllm/bin/python",
    ".venv/bin/python",
  ];
}

async function runCheckOnlyPreflight(options: AirLlmEnvironmentProofOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function gate(name: string, passed: boolean, message: string): AirLlmSafetyGate {
  return {
    name,
    status: passed ? "passed" : "failed",
    required: true,
    message,
  };
}

function statusGate(name: string, status: SuperCheckStatus, message: string): AirLlmSafetyGate {
  return {
    name,
    status,
    required: true,
    message,
  };
}

function parseImportJson(value: string): Record<string, unknown> | null {
  return parseJson(value);
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

function safeEnvironmentSnapshot(env: NodeJS.ProcessEnv): Record<string, string | null> {
  return {
    AIRLLM_PYTHON: env.AIRLLM_PYTHON ?? null,
    VIRTUAL_ENV: env.VIRTUAL_ENV ?? null,
    CUDA_VISIBLE_DEVICES: env.CUDA_VISIBLE_DEVICES ?? null,
    PYTHONPATH_SET: env.PYTHONPATH ? "set" : null,
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5_000,
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

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
