import { execFile } from "child_process";
import { constants as fsConstants } from "fs";
import { access, mkdir, readdir, readFile, stat, statfs, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  resolveModelRole,
  validateModelRoleAssignment,
  type ModelRoleAssignment,
} from "../model-role-stub";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";

const execFileAsync = promisify(execFile);

export type SuperCompatibilityVerdict = "go_for_future_boot_probe" | "no_go" | "unknown";
export type SuperCheckStatus = "passed" | "failed" | "unknown";
export type SuperBootProbeMode = "disabled" | "dry_run_plan_only" | "explicit_allowlisted_boot_probe";

export interface SuperCompatibilityAuditConfig {
  seniorRoleId: string;
  auditMode: "non_loading_audit";
  evidenceRoot: string;
  bootProbeMode: SuperBootProbeMode;
}

export interface ParsedAirLlmUri {
  raw: string | null;
  scheme: "airllm" | "unknown";
  model_path: string | null;
  diagnostics: string[];
}

export interface SuperModelArtifactCheck {
  status: SuperCheckStatus;
  configured_uri: string | null;
  model_path: string | null;
  path_exists: boolean;
  readable: boolean;
  expected_model_name_consistent: boolean;
  config_files: string[];
  tokenizer_files: string[];
  weight_files: string[];
  index_files: string[];
  total_size_bytes: number | null;
  partial_artifact_indicators: string[];
  diagnostics: string[];
}

export interface SuperRuntimeDependencyCheck {
  name: string;
  status: SuperCheckStatus;
  command: string | null;
  details: string | null;
  diagnostics: string[];
}

export interface SuperHardwareSnapshot {
  status: SuperCheckStatus;
  gpu_summary: string | null;
  memory_summary: {
    total_bytes: number | null;
    free_bytes: number | null;
  };
  disk_summary: {
    path: string | null;
    total_bytes: number | null;
    free_bytes: number | null;
  };
  diagnostics: string[];
}

export interface SuperSafetyGate {
  name: string;
  status: SuperCheckStatus;
  required: boolean;
  message: string;
}

export interface SuperBootProbePlan {
  mode: SuperBootProbeMode;
  status: "disabled" | "dry_run_plan_only" | "blocked";
  required_guards: string[];
  guards_satisfied: string[];
  blocked_reason: string | null;
  command: string | null;
}

export interface SuperCompatibilityAuditResult {
  audit_id: string;
  timestamp: string;
  senior_role_id: string;
  senior_role_resolution: ModelRoleAssignment;
  configured_provider: string | null;
  configured_model_path: string | null;
  expected_model: string | null;
  audit_mode: "non_loading_audit";
  parsed_airllm_uri: ParsedAirLlmUri;
  model_artifact_check: SuperModelArtifactCheck;
  dependency_checks: SuperRuntimeDependencyCheck[];
  hardware_snapshot: SuperHardwareSnapshot;
  safety_gates: SuperSafetyGate[];
  boot_probe_plan: SuperBootProbePlan;
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  final_verdict: SuperCompatibilityVerdict;
  blocked_reasons: string[];
  warnings: string[];
  evidence_path: string;
  fallback_used: false;
  airllm_super_used: false;
  qwen_used: false;
  super_model_load_performed: false;
  super_model_inference_performed: false;
  integration_performed: false;
}

export interface SuperCompatibilityAuditOptions {
  env?: NodeJS.ProcessEnv;
  evidenceRoot?: string;
  now?: () => Date;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  commandRunner?: SuperAuditCommandRunner;
  bootProbeMode?: SuperBootProbeMode;
  safetyOverrides?: Partial<{
    airllmSuperStarted: boolean;
    qwenUsed: boolean;
    fallbackUsed: boolean;
    integrationPerformed: boolean;
    uncontrolledProcessOperation: boolean;
  }>;
}

export type SuperAuditCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const DEFAULT_SUPER_COMPATIBILITY_AUDIT_CONFIG: SuperCompatibilityAuditConfig = {
  seniorRoleId: "console_senior_worker",
  auditMode: "non_loading_audit",
  evidenceRoot: "evidence/super-compatibility",
  bootProbeMode: "disabled",
};

export function parseAirLlmUri(value: string | null): ParsedAirLlmUri {
  if (!value) {
    return {
      raw: value,
      scheme: "unknown",
      model_path: null,
      diagnostics: ["SUPER_AUDIT_URI_MISSING"],
    };
  }
  if (!value.startsWith("airllm://")) {
    return {
      raw: value,
      scheme: "unknown",
      model_path: null,
      diagnostics: ["SUPER_AUDIT_URI_SCHEME_NOT_AIRLLM"],
    };
  }
  const modelPath = value.replace(/^airllm:\/\//, "");
  return {
    raw: value,
    scheme: "airllm",
    model_path: modelPath.startsWith("/") ? modelPath : `/${modelPath}`,
    diagnostics: [],
  };
}

export async function auditSuperModelArtifacts(input: {
  parsedUri: ParsedAirLlmUri;
  expectedModel: string | null;
}): Promise<SuperModelArtifactCheck> {
  const modelPath = input.parsedUri.model_path;
  const base = {
    configured_uri: input.parsedUri.raw,
    model_path: modelPath,
    path_exists: false,
    readable: false,
    expected_model_name_consistent: false,
    config_files: [] as string[],
    tokenizer_files: [] as string[],
    weight_files: [] as string[],
    index_files: [] as string[],
    total_size_bytes: null as number | null,
    partial_artifact_indicators: [] as string[],
    diagnostics: [...input.parsedUri.diagnostics],
  };
  if (!modelPath) {
    return {
      ...base,
      status: "unknown",
      diagnostics: [...base.diagnostics, "SUPER_AUDIT_MODEL_PATH_MISSING"],
    };
  }

  try {
    const modelStat = await stat(modelPath);
    if (!modelStat.isDirectory()) {
      return {
        ...base,
        path_exists: true,
        status: "failed",
        diagnostics: ["SUPER_AUDIT_MODEL_PATH_NOT_DIRECTORY"],
      };
    }
  } catch (error) {
    return {
      ...base,
      status: "failed",
      diagnostics: [
        error instanceof Error ? `SUPER_AUDIT_MODEL_PATH_MISSING:${error.message}` : "SUPER_AUDIT_MODEL_PATH_MISSING",
      ],
    };
  }

  let readable = false;
  try {
    await access(modelPath, fsConstants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(modelPath);
  } catch (error) {
    return {
      ...base,
      path_exists: true,
      readable,
      status: "failed",
      diagnostics: [
        error instanceof Error ? `SUPER_AUDIT_MODEL_PATH_UNREADABLE:${error.message}` : "SUPER_AUDIT_MODEL_PATH_UNREADABLE",
      ],
    };
  }

  const configFiles = entries.filter((entry) => ["config.json", "generation_config.json"].includes(entry));
  const tokenizerFiles = entries.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower.includes("tokenizer") || lower === "vocab.json" || lower === "merges.txt" || lower.endsWith(".model");
  });
  const weightFiles = entries.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower.endsWith(".safetensors") || lower.endsWith(".bin") || lower.endsWith(".pt");
  });
  const indexFiles = entries.filter((entry) => entry.toLowerCase().endsWith(".index.json"));
  const partial = entries.filter((entry) => /tmp|partial|incomplete|download|lock/i.test(entry));
  const totalSize = await safeDirectorySize(modelPath, entries);
  const configConsistent = await configLooksConsistent(modelPath, input.expectedModel);
  const modelNameConsistent = path.basename(modelPath).toLowerCase().includes("nemotron")
    && path.basename(modelPath).toLowerCase().includes("super");
  const requiredMissing = [
    configFiles.length === 0 ? "SUPER_AUDIT_CONFIG_JSON_MISSING" : null,
    tokenizerFiles.length === 0 ? "SUPER_AUDIT_TOKENIZER_FILES_MISSING" : null,
    weightFiles.length === 0 ? "SUPER_AUDIT_WEIGHT_SHARDS_MISSING" : null,
  ].filter((entry): entry is string => !!entry);
  const diagnostics = [
    ...base.diagnostics,
    ...requiredMissing,
    ...partial.map((entry) => `SUPER_AUDIT_PARTIAL_ARTIFACT_INDICATOR:${entry}`),
    configConsistent === false ? "SUPER_AUDIT_CONFIG_MODEL_NAME_MISMATCH" : null,
  ].filter((entry): entry is string => !!entry);

  return {
    configured_uri: input.parsedUri.raw,
    model_path: modelPath,
    path_exists: true,
    readable,
    expected_model_name_consistent: configConsistent === true || modelNameConsistent,
    config_files: configFiles,
    tokenizer_files: tokenizerFiles,
    weight_files: weightFiles,
    index_files: indexFiles,
    total_size_bytes: totalSize,
    partial_artifact_indicators: partial,
    diagnostics,
    status: readable && requiredMissing.length === 0 && partial.length === 0 ? "passed" : "failed",
  };
}

export async function auditAirLLMDependencies(
  runner: SuperAuditCommandRunner = defaultCommandRunner,
): Promise<SuperRuntimeDependencyCheck[]> {
  const checks: SuperRuntimeDependencyCheck[] = [];
  const pythonCheck = await pythonAvailabilityCheck(runner);
  checks.push(pythonCheck.check);
  checks.push(await commandCheck(pythonCheck.executable ?? "python3", ["-c", "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('airllm') else 2)"], "airllm_import_discoverable", runner, {
    unavailableStatus: "unknown",
    unavailableMessage: "SUPER_AUDIT_AIRLLM_IMPORT_NOT_DISCOVERABLE",
  }));
  checks.push(await commandCheck("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.free,memory.used", "--format=csv,noheader"], "nvidia_smi_available", runner));
  return checks;
}

async function pythonAvailabilityCheck(
  runner: SuperAuditCommandRunner,
): Promise<{ executable: string | null; check: SuperRuntimeDependencyCheck }> {
  const python = await commandCheck("python", ["--version"], "python_available", runner, {
    unavailableStatus: "unknown",
    unavailableMessage: "SUPER_AUDIT_PYTHON_COMMAND_NOT_AVAILABLE",
  });
  if (python.status === "passed") return { executable: "python", check: python };
  const python3 = await commandCheck("python3", ["--version"], "python_available", runner, {
    unavailableStatus: "unknown",
    unavailableMessage: "SUPER_AUDIT_PYTHON3_COMMAND_NOT_AVAILABLE",
  });
  if (python3.status === "passed") return { executable: "python3", check: python3 };
  return {
    executable: null,
    check: {
      ...python3,
      diagnostics: [...python.diagnostics, ...python3.diagnostics],
    },
  };
}

export async function auditHardwareForSuper(input: {
  modelPath: string | null;
  runner?: SuperAuditCommandRunner;
}): Promise<SuperHardwareSnapshot> {
  const runner = input.runner ?? defaultCommandRunner;
  const diagnostics: string[] = [];
  let gpuSummary: string | null = null;
  try {
    const result = await runner("nvidia-smi", ["--query-gpu=index,name,memory.total,memory.free,memory.used,driver_version", "--format=csv,noheader,nounits"]);
    if (result.exitCode === 0) {
      gpuSummary = result.stdout.trim() || null;
    } else {
      diagnostics.push(`SUPER_AUDIT_NVIDIA_SMI_FAILED:${result.stderr || result.stdout}`);
    }
  } catch (error) {
    diagnostics.push(error instanceof Error ? `SUPER_AUDIT_NVIDIA_SMI_UNAVAILABLE:${error.message}` : "SUPER_AUDIT_NVIDIA_SMI_UNAVAILABLE");
  }

  let diskSummary = {
    path: input.modelPath,
    total_bytes: null as number | null,
    free_bytes: null as number | null,
  };
  if (input.modelPath) {
    try {
      const fs = await statfs(input.modelPath);
      diskSummary = {
        path: input.modelPath,
        total_bytes: Number(fs.blocks) * Number(fs.bsize),
        free_bytes: Number(fs.bavail) * Number(fs.bsize),
      };
    } catch (error) {
      diagnostics.push(error instanceof Error ? `SUPER_AUDIT_DISK_SNAPSHOT_FAILED:${error.message}` : "SUPER_AUDIT_DISK_SNAPSHOT_FAILED");
    }
  }

  const memorySummary = {
    total_bytes: os.totalmem(),
    free_bytes: os.freemem(),
  };
  return {
    status: gpuSummary || memorySummary.total_bytes || diskSummary.free_bytes ? diagnostics.length === 0 ? "passed" : "unknown" : "unknown",
    gpu_summary: gpuSummary,
    memory_summary: memorySummary,
    disk_summary: diskSummary,
    diagnostics,
  };
}

export function createSuperBootProbePlan(input: {
  mode: SuperBootProbeMode;
  seniorRole: ModelRoleAssignment;
  nanoPreflightStatus: string | null;
  allowFlag?: boolean;
  confirmFlag?: boolean;
}): SuperBootProbePlan {
  const requiredGuards = [
    "--allow-super-boot-probe",
    "--confirm-super-boot-probe",
    "role_id:console_senior_worker",
    "nano_preflight:healthy",
    "no_qwen_or_fallback",
    "evidence_path_configured",
  ];
  if (input.mode === "disabled") {
    return {
      mode: input.mode,
      status: "disabled",
      required_guards: requiredGuards,
      guards_satisfied: [],
      blocked_reason: "SUPER_BOOT_PROBE_DISABLED_FOR_PHASE_8",
      command: null,
    };
  }
  const guardsSatisfied = [
    input.allowFlag ? "--allow-super-boot-probe" : null,
    input.confirmFlag ? "--confirm-super-boot-probe" : null,
    input.seniorRole.roleId === "console_senior_worker" ? "role_id:console_senior_worker" : null,
    input.nanoPreflightStatus === "healthy" ? "nano_preflight:healthy" : null,
    "no_qwen_or_fallback",
    "evidence_path_configured",
  ].filter((entry): entry is string => !!entry);
  return {
    mode: input.mode,
    status: input.mode === "dry_run_plan_only" ? "dry_run_plan_only" : "blocked",
    required_guards: requiredGuards,
    guards_satisfied: guardsSatisfied,
    blocked_reason: "SUPER_BOOT_PROBE_NOT_EXECUTED_IN_PHASE_8",
    command: null,
  };
}

export function evaluateSuperCompatibilityGates(input: {
  seniorRole: ModelRoleAssignment;
  artifactCheck: SuperModelArtifactCheck;
  dependencyChecks: SuperRuntimeDependencyCheck[];
  hardwareSnapshot: SuperHardwareSnapshot;
  preflightRuntimeStatus: string | null;
  postflightRuntimeStatus: string | null;
  safetyOverrides?: SuperCompatibilityAuditOptions["safetyOverrides"];
}): { gates: SuperSafetyGate[]; verdict: SuperCompatibilityVerdict; blockedReasons: string[]; warnings: string[] } {
  const safety = input.safetyOverrides ?? {};
  const gates: SuperSafetyGate[] = [
    gate("nano_roles_primary_and_healthy", input.preflightRuntimeStatus === "healthy" && input.postflightRuntimeStatus === "healthy", "Nano runtime preflight/postflight remained healthy."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("super_not_started", safety.airllmSuperStarted !== true, "AirLLM/Super was not started."),
    gate("qwen_not_used", safety.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true, "No fallback model was used."),
    gate("no_integration", safety.integrationPerformed !== true, "No integration occurred."),
    gate("no_uncontrolled_process_operations", safety.uncontrolledProcessOperation !== true, "No uncontrolled process operations occurred."),
    gate("model_artifacts_discoverable", input.artifactCheck.status === "passed", "Model artifacts are discoverable without loading."),
    gate("dependency_audit_completed", input.dependencyChecks.length > 0 && input.dependencyChecks.every((check) => check.status !== "failed"), "Dependency audit completed without hard failure."),
    gate("hardware_snapshot_captured", input.hardwareSnapshot.status !== "failed", "Hardware/resource snapshot was captured or safely degraded."),
  ];
  const blockedReasons = gates
    .filter((item) => item.required && item.status === "failed")
    .map((item) => `${item.name}:${item.message}`);
  const warnings = [
    ...input.dependencyChecks.filter((check) => check.status === "unknown").map((check) => `${check.name}:${check.diagnostics.join(";") || "unknown"}`),
    ...input.hardwareSnapshot.diagnostics,
  ];
  const safetyFailure = gates.some((item) => [
    "nano_roles_primary_and_healthy",
    "senior_role_blocked_unproven",
    "super_not_started",
    "qwen_not_used",
    "fallback_not_used",
    "no_integration",
    "no_uncontrolled_process_operations",
  ].includes(item.name) && item.status === "failed");
  const verdict: SuperCompatibilityVerdict = safetyFailure || input.artifactCheck.status === "failed"
    ? "no_go"
    : input.artifactCheck.status === "passed" && input.dependencyChecks.every((check) => check.status === "passed") && input.hardwareSnapshot.status === "passed"
      ? "go_for_future_boot_probe"
      : "unknown";
  return { gates, verdict, blockedReasons, warnings };
}

export async function runSuperCompatibilityAudit(
  options: SuperCompatibilityAuditOptions = {},
): Promise<SuperCompatibilityAuditResult> {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const config: SuperCompatibilityAuditConfig = {
    ...DEFAULT_SUPER_COMPATIBILITY_AUDIT_CONFIG,
    evidenceRoot: options.evidenceRoot ?? DEFAULT_SUPER_COMPATIBILITY_AUDIT_CONFIG.evidenceRoot,
    bootProbeMode: options.bootProbeMode ?? DEFAULT_SUPER_COMPATIBILITY_AUDIT_CONFIG.bootProbeMode,
  };
  const auditId = `phase-8-super-compatibility-audit-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(config.evidenceRoot, `${auditId}.json`);
  const preflight = await runCheckOnlyPreflight(options);
  const seniorRole = resolveModelRole(config.seniorRoleId, options.env);
  const parsedUri = parseAirLlmUri(seniorRole.endpoint);
  const artifactCheck = await auditSuperModelArtifacts({
    parsedUri,
    expectedModel: seniorRole.model,
  });
  const dependencyChecks = await auditAirLLMDependencies(options.commandRunner);
  const hardwareSnapshot = await auditHardwareForSuper({
    modelPath: parsedUri.model_path,
    runner: options.commandRunner,
  });
  const bootProbePlan = createSuperBootProbePlan({
    mode: config.bootProbeMode,
    seniorRole,
    nanoPreflightStatus: preflight.status,
  });
  const postflight = await runCheckOnlyPreflight(options);
  const gateEvaluation = evaluateSuperCompatibilityGates({
    seniorRole,
    artifactCheck,
    dependencyChecks,
    hardwareSnapshot,
    preflightRuntimeStatus: preflight.status,
    postflightRuntimeStatus: postflight.status,
    safetyOverrides: options.safetyOverrides,
  });
  const roleDiagnostics = validateModelRoleAssignment(seniorRole);
  const result: SuperCompatibilityAuditResult = {
    audit_id: auditId,
    timestamp,
    senior_role_id: seniorRole.roleId,
    senior_role_resolution: seniorRole,
    configured_provider: seniorRole.provider,
    configured_model_path: parsedUri.model_path,
    expected_model: seniorRole.model,
    audit_mode: "non_loading_audit",
    parsed_airllm_uri: parsedUri,
    model_artifact_check: artifactCheck,
    dependency_checks: dependencyChecks,
    hardware_snapshot: hardwareSnapshot,
    safety_gates: gateEvaluation.gates,
    boot_probe_plan: bootProbePlan,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    final_verdict: gateEvaluation.verdict,
    blocked_reasons: [...roleDiagnostics, ...artifactCheck.diagnostics, ...gateEvaluation.blockedReasons],
    warnings: gateEvaluation.warnings,
    evidence_path: evidencePath,
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
  };
  await writeJson(evidencePath, result);
  return result;
}

async function runCheckOnlyPreflight(options: SuperCompatibilityAuditOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function gate(name: string, passed: boolean, message: string): SuperSafetyGate {
  return {
    name,
    status: passed ? "passed" : "failed",
    required: true,
    message,
  };
}

async function commandCheck(
  command: string,
  args: string[],
  name: string,
  runner: SuperAuditCommandRunner,
  options: { unavailableStatus?: SuperCheckStatus; unavailableMessage?: string } = {},
): Promise<SuperRuntimeDependencyCheck> {
  try {
    const result = await runner(command, args);
    if (result.exitCode === 0) {
      return {
        name,
        status: "passed",
        command: [command, ...args].join(" "),
        details: (result.stdout || result.stderr).trim() || null,
        diagnostics: [],
      };
    }
    return {
      name,
      status: options.unavailableStatus ?? "failed",
      command: [command, ...args].join(" "),
      details: (result.stdout || result.stderr).trim() || null,
      diagnostics: [options.unavailableMessage ?? `${name.toUpperCase()}_FAILED:${result.exitCode}`],
    };
  } catch (error) {
    return {
      name,
      status: options.unavailableStatus ?? "unknown",
      command: [command, ...args].join(" "),
      details: null,
      diagnostics: [
        error instanceof Error ? `${name.toUpperCase()}_UNAVAILABLE:${error.message}` : `${name.toUpperCase()}_UNAVAILABLE`,
      ],
    };
  }
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, { maxBuffer: 4 * 1024 * 1024, timeout: 5_000 });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const maybeError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
    };
  }
}

async function safeDirectorySize(modelPath: string, entries: string[]): Promise<number | null> {
  let total = 0;
  for (const entry of entries) {
    try {
      const entryStat = await stat(path.join(modelPath, entry));
      if (entryStat.isFile()) total += entryStat.size;
    } catch {
      return null;
    }
  }
  return total;
}

async function configLooksConsistent(modelPath: string, expectedModel: string | null): Promise<boolean | null> {
  if (!expectedModel) return null;
  try {
    const raw = await readFile(path.join(modelPath, "config.json"), "utf8");
    const lower = raw.toLowerCase();
    return lower.includes("nemotron") || lower.includes("super") || lower.includes("nvidia");
  } catch {
    return null;
  }
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
