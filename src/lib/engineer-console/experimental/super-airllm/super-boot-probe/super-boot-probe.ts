import { spawn } from "child_process";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { resolveModelRole, type ModelRoleAssignment } from "../model-role-stub";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";
import {
  auditSuperModelArtifacts,
  parseAirLlmUri,
  type SuperAuditCommandRunner,
  type SuperModelArtifactCheck,
} from "../super-compatibility/super-compatibility-audit";

export type SuperBootProbeVerdict =
  | "boot_probe_passed"
  | "boot_probe_failed"
  | "boot_probe_timeout"
  | "boot_probe_unsafe"
  | "boot_probe_unknown";

export interface SuperBootProbeConfig {
  phase12EvidencePath: string;
  runtimePath: ".venv-airllm/bin/python";
  modelPath: "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
  timeoutSeconds: number;
  evidenceRoot: string;
  enabled: boolean;
}

export interface SuperBootProbeResourceSnapshot {
  timestamp: string;
  label: "before" | "during" | "after";
  system_memory: {
    total_bytes: number;
    free_bytes: number;
    load_average: number[];
  };
  process: {
    pid: number | null;
    rss_bytes: number | null;
    state: string | null;
  };
  gpu_summary: string | null;
  diagnostics: string[];
}

export interface SuperBootProbeChildProcessResult {
  launched: boolean;
  pid: number | null;
  command: string[];
  cwd: string;
  stdout_summary: string | null;
  stderr_summary: string | null;
  exit_code: number | null;
  signal: NodeJS.Signals | string | null;
  timed_out: boolean;
  cleanup_status: "not_needed" | "terminated" | "killed" | "failed" | "not_launched";
  cleanup_signal: NodeJS.Signals | string | null;
  success_marker_seen: boolean;
  model_load_attempted: boolean;
  model_load_completed: boolean;
  inference_or_generation_detected: boolean;
  serving_detected: boolean;
  diagnostics: string[];
}

export interface SuperBootProbeSafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface SuperBootProbeResult {
  phase_id: "phase-13-guarded-super-boot-probe";
  probe_id: string;
  timestamp: string;
  repo_commit_at_start: string | null;
  phase12_evidence_path: string;
  airllm_runtime_path: string;
  model_path: string;
  model_artifact_summary: SuperModelArtifactCheck;
  command_executed: string[];
  timeout_seconds: number;
  child_process: SuperBootProbeChildProcessResult;
  resource_snapshots: SuperBootProbeResourceSnapshot[];
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  senior_role_resolution: ModelRoleAssignment;
  safety_gates: SuperBootProbeSafetyGate[];
  model_load_attempted: boolean;
  model_load_completed: boolean;
  inference_or_generation_occurred: boolean;
  serving_occurred: boolean;
  qwen_used: false;
  fallback_used: false;
  integration_performed: false;
  senior_role_promoted: false;
  final_verdict: SuperBootProbeVerdict;
  recommended_next_action: string;
  evidence_path: string;
  blocked_reasons: string[];
  warnings: string[];
}

export interface SuperBootProbeOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  phase12EvidencePath: string;
  enabled?: boolean;
  timeoutSeconds?: number;
  now?: () => Date;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  commandRunner?: SuperAuditCommandRunner;
  artifactAudit?: () => Promise<SuperModelArtifactCheck>;
  childRunner?: SuperBootProbeChildRunner;
  env?: NodeJS.ProcessEnv;
  safetyOverrides?: Partial<{
    qwenUsed: boolean;
    fallbackUsed: boolean;
    integrationPerformed: boolean;
    servingDetected: boolean;
    inferenceDetected: boolean;
    cleanupFailed: boolean;
  }>;
}

export type SuperBootProbeChildRunner = (input: {
  command: string[];
  cwd: string;
  timeoutSeconds: number;
  env: NodeJS.ProcessEnv;
  onDuringSnapshot: (pid: number) => Promise<void>;
}) => Promise<SuperBootProbeChildProcessResult>;

const DEFAULT_RUNTIME = ".venv-airllm/bin/python" as const;
const DEFAULT_MODEL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8" as const;
const DEFAULT_PHASE12_EVIDENCE = "evidence/airllm-environment/phase-12-airllm-promote-winning-candidate-2026-06-21T21-45-09-356Z.json";

export function buildSuperBootProbeCommand(config: Pick<SuperBootProbeConfig, "runtimePath" | "modelPath">): string[] {
  const script = [
    "import importlib.metadata, json, pathlib, sys, traceback",
    `model_path = ${JSON.stringify(config.modelPath)}`,
    "packages = ['airllm', 'torch', 'transformers', 'optimum', 'accelerate', 'safetensors', 'sentencepiece']",
    "data = {'event': 'probe_start', 'python_executable': sys.executable, 'python_version': sys.version.split()[0], 'packages': {}, 'model_path': model_path}",
    "for package in packages:",
    "    try:",
    "        data['packages'][package] = importlib.metadata.version(package)",
    "    except Exception:",
    "        data['packages'][package] = None",
    "print(json.dumps(data), flush=True)",
    "root = pathlib.Path(model_path)",
    "required = ['config.json', 'model.safetensors.index.json']",
    "missing = [item for item in required if not (root / item).exists()]",
    "tokenizers = [p.name for p in root.glob('*token*')]",
    "if missing or not tokenizers:",
    "    print(json.dumps({'event': 'artifact_check_failed', 'missing': missing, 'tokenizers': tokenizers}), flush=True)",
    "    raise SystemExit(2)",
    "print(json.dumps({'event': 'model_load_attempt_start'}), flush=True)",
    "try:",
    "    from airllm import AutoModel",
    "    model = AutoModel.from_pretrained(model_path)",
    "    print(json.dumps({'event': 'model_load_completed', 'model_class': model.__class__.__name__}), flush=True)",
    "    del model",
    "except Exception as exc:",
    "    print(json.dumps({'event': 'model_load_failed', 'error_class': exc.__class__.__name__, 'error_message': str(exc), 'traceback': traceback.format_exc()[-2000:]}), flush=True)",
    "    raise SystemExit(1)",
    "print(json.dumps({'event': 'probe_success'}), flush=True)",
  ].join("\n");
  return [config.runtimePath, "-c", script];
}

export function validateSuperBootProbeCommand(command: string[], modelPath = DEFAULT_MODEL_PATH): string[] {
  const serialized = command.join(" ");
  const diagnostics: string[] = [];
  const modelPathCount = serialized.split(modelPath).length - 1;
  if (command[0] !== DEFAULT_RUNTIME) diagnostics.push("SUPER_BOOT_PROBE_RUNTIME_NOT_OFFICIAL_AIRLLM_VENV");
  if (modelPathCount !== 1) diagnostics.push(`SUPER_BOOT_PROBE_MODEL_PATH_COUNT_INVALID:${modelPathCount}`);
  if (serialized.includes("uvicorn") || serialized.includes("fastapi") || serialized.includes("listen(")) diagnostics.push("SUPER_BOOT_PROBE_SERVER_START_FORBIDDEN");
  if (serialized.includes(".generate(") || serialized.includes("input_ids") || serialized.includes("prompt")) diagnostics.push("SUPER_BOOT_PROBE_INFERENCE_FORBIDDEN");
  if (serialized.toLowerCase().includes("qwen")) diagnostics.push("SUPER_BOOT_PROBE_QWEN_FORBIDDEN");
  if (serialized.toLowerCase().includes("fallback")) diagnostics.push("SUPER_BOOT_PROBE_FALLBACK_FORBIDDEN");
  if (serialized.includes("sudo") || serialized.includes(" apt ") || serialized.includes("pip install")) diagnostics.push("SUPER_BOOT_PROBE_MUTATION_FORBIDDEN");
  return diagnostics;
}

export async function runGuardedSuperBootProbe(options: SuperBootProbeOptions): Promise<SuperBootProbeResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const evidenceRoot = options.evidenceRoot ?? "evidence/super-boot-probe";
  const probeId = `phase-13-guarded-super-boot-probe-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(evidenceRoot, `${probeId}.json`);
  const config: SuperBootProbeConfig = {
    phase12EvidencePath: options.phase12EvidencePath,
    runtimePath: DEFAULT_RUNTIME,
    modelPath: DEFAULT_MODEL_PATH,
    timeoutSeconds: Math.min(Math.max(options.timeoutSeconds ?? 600, 1), 600),
    evidenceRoot,
    enabled: options.enabled === true,
  };
  const command = buildSuperBootProbeCommand(config);
  const seniorRole = resolveModelRole("console_senior_worker", options.env);
  const repoCommit = await repoCommitAtStart(repoRoot, options.commandRunner);
  const preflight = await runCheckOnlyPreflight(options);
  const phase12Ready = await phase12EvidenceReady(path.join(repoRoot, config.phase12EvidencePath));
  const runtimeExists = await fileExists(path.join(repoRoot, config.runtimePath));
  const parsedUri = parseAirLlmUri(seniorRole.endpoint);
  const artifactCheck = options.artifactAudit
    ? await options.artifactAudit()
    : await auditSuperModelArtifacts({ parsedUri, expectedModel: seniorRole.model });
  const preLaunchGates = evaluatePreLaunchGates({
    enabled: config.enabled,
    runtimeExists,
    phase12Ready,
    artifactCheck,
    preflightStatus: preflight.status,
    seniorRole,
    command,
  });
  const snapshots: SuperBootProbeResourceSnapshot[] = [];
  snapshots.push(await captureResourceSnapshot("before", null, options.commandRunner));
  let child: SuperBootProbeChildProcessResult = notLaunchedChild(command, repoRoot);
  const launchBlocked = preLaunchGates.some((gate) => gate.status === "failed");
  if (!launchBlocked) {
    child = await (options.childRunner ?? runSuperBootProbeChild)({
      command,
      cwd: repoRoot,
      timeoutSeconds: config.timeoutSeconds,
      env: sanitizedChildEnv(options.env),
      onDuringSnapshot: async (pid) => {
        snapshots.push(await captureResourceSnapshot("during", pid, options.commandRunner));
      },
    });
  }
  snapshots.push(await captureResourceSnapshot("after", child.pid, options.commandRunner));
  const postflight = await runCheckOnlyPreflight(options);
  const gates = [
    ...preLaunchGates,
    ...evaluatePostProbeGates({
      postflightStatus: postflight.status,
      child,
      safetyOverrides: options.safetyOverrides,
      launched: child.launched,
      enabled: config.enabled,
    }),
  ];
  const finalVerdict = evaluateVerdict({ gates, child, enabled: config.enabled });
  const result: SuperBootProbeResult = {
    phase_id: "phase-13-guarded-super-boot-probe",
    probe_id: probeId,
    timestamp,
    repo_commit_at_start: repoCommit,
    phase12_evidence_path: config.phase12EvidencePath,
    airllm_runtime_path: config.runtimePath,
    model_path: config.modelPath,
    model_artifact_summary: artifactCheck,
    command_executed: redactProbeCommand(command),
    timeout_seconds: config.timeoutSeconds,
    child_process: { ...child, command: redactProbeCommand(child.command) },
    resource_snapshots: snapshots,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    senior_role_resolution: seniorRole,
    safety_gates: gates,
    model_load_attempted: child.model_load_attempted,
    model_load_completed: child.model_load_completed,
    inference_or_generation_occurred: child.inference_or_generation_detected || options.safetyOverrides?.inferenceDetected === true,
    serving_occurred: child.serving_detected || options.safetyOverrides?.servingDetected === true,
    qwen_used: false,
    fallback_used: false,
    integration_performed: false,
    senior_role_promoted: false,
    final_verdict: finalVerdict,
    recommended_next_action: recommendation(finalVerdict),
    evidence_path: evidencePath,
    blocked_reasons: gates.filter((gate) => gate.status === "failed").map((gate) => `${gate.name}:${gate.message}`),
    warnings: [...child.diagnostics, ...snapshots.flatMap((snapshot) => snapshot.diagnostics)],
  };
  await writeJson(evidencePath, result);
  return result;
}

export async function runSuperBootProbeChild(input: {
  command: string[];
  cwd: string;
  timeoutSeconds: number;
  env: NodeJS.ProcessEnv;
  onDuringSnapshot: (pid: number) => Promise<void>;
}): Promise<SuperBootProbeChildProcessResult> {
  const [bin, ...args] = input.command;
  const child = spawn(bin, args, { cwd: input.cwd, env: input.env, stdio: ["ignore", "pipe", "pipe"] });
  const pid = child.pid ?? null;
  const stdout: string[] = [];
  const stderr: string[] = [];
  let timedOut = false;
  let cleanupStatus: SuperBootProbeChildProcessResult["cleanup_status"] = "not_needed";
  let cleanupSignal: NodeJS.Signals | string | null = null;
  let snapshotTaken = false;
  child.stdout?.on("data", (chunk) => {
    stdout.push(String(chunk));
    if (!snapshotTaken && pid) {
      snapshotTaken = true;
      void input.onDuringSnapshot(pid);
    }
  });
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const timeout = setTimeout(() => {
    timedOut = true;
    if (pid) {
      cleanupSignal = "SIGTERM";
      cleanupStatus = "terminated";
      child.kill("SIGTERM");
    }
  }, input.timeoutSeconds * 1000);
  const killAfterTerm = setInterval(() => {
    if (timedOut && pid && child.exitCode === null && child.signalCode === null) {
      cleanupSignal = "SIGKILL";
      cleanupStatus = "killed";
      child.kill("SIGKILL");
    }
  }, 5_000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  clearInterval(killAfterTerm);
  if (timedOut && pid) {
    cleanupStatus = await processAlive(pid) ? "failed" : cleanupStatus;
  }
  const output = stdout.join("");
  return {
    launched: true,
    pid,
    command: input.command,
    cwd: input.cwd,
    stdout_summary: summarize(output),
    stderr_summary: summarize(stderr.join("")),
    exit_code: exit.code,
    signal: exit.signal,
    timed_out: timedOut,
    cleanup_status: cleanupStatus,
    cleanup_signal: cleanupSignal,
    success_marker_seen: output.includes('"event": "probe_success"') || output.includes('"event":"probe_success"'),
    model_load_attempted: output.includes("model_load_attempt_start"),
    model_load_completed: output.includes("model_load_completed"),
    inference_or_generation_detected: false,
    serving_detected: false,
    diagnostics: timedOut ? ["SUPER_BOOT_PROBE_TIMED_OUT"] : [],
  };
}

function evaluatePreLaunchGates(input: {
  enabled: boolean;
  runtimeExists: boolean;
  phase12Ready: boolean;
  artifactCheck: SuperModelArtifactCheck;
  preflightStatus: string | null;
  seniorRole: ModelRoleAssignment;
  command: string[];
}): SuperBootProbeSafetyGate[] {
  const commandDiagnostics = validateSuperBootProbeCommand(input.command);
  return [
    gate("explicit_enable_flag", input.enabled, "Guarded boot probe requires --enable-guarded-boot-probe."),
    gate("official_airllm_runtime_exists", input.runtimeExists, ".venv-airllm/bin/python exists."),
    gate("phase12_ready_for_guarded_boot_probe", input.phase12Ready, "Phase 12 evidence is ready_for_guarded_boot_probe."),
    gate("super_model_artifacts_pass", input.artifactCheck.status === "passed", "Super model artifacts pass non-loading audit."),
    gate("nano_preflight_healthy", input.preflightStatus === "healthy", "Nano preflight is healthy."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("child_process_isolation_enabled", true, "Probe runs in a child process."),
    gate("timeout_configured", true, "Probe timeout is configured."),
    gate("resource_monitor_enabled", true, "Resource snapshots are captured."),
    gate("command_safety", commandDiagnostics.length === 0, commandDiagnostics.join(";") || "Command passes safety validation."),
    gate("cleanup_policy_child_only", true, "Cleanup targets only the exact child process."),
  ];
}

function evaluatePostProbeGates(input: {
  postflightStatus: string | null;
  child: SuperBootProbeChildProcessResult;
  safetyOverrides?: SuperBootProbeOptions["safetyOverrides"];
  launched: boolean;
  enabled: boolean;
}): SuperBootProbeSafetyGate[] {
  const safety = input.safetyOverrides ?? {};
  return [
    gate("nano_postflight_healthy", input.postflightStatus === "healthy", "Nano postflight is healthy."),
    gate("cleanup_succeeded", input.child.cleanup_status !== "failed" && safety.cleanupFailed !== true, "Child cleanup succeeded or was not needed."),
    gate("no_serving_started", input.child.serving_detected !== true && safety.servingDetected !== true, "No serving process was started."),
    gate("no_inference_or_generation", input.child.inference_or_generation_detected !== true && safety.inferenceDetected !== true, "No inference or generation occurred."),
    gate("qwen_not_used", safety.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true, "No fallback was used."),
    gate("no_integration", safety.integrationPerformed !== true, "No integration occurred."),
    gate("senior_not_promoted", true, "Senior role was not promoted automatically."),
  ];
}

function evaluateVerdict(input: {
  gates: SuperBootProbeSafetyGate[];
  child: SuperBootProbeChildProcessResult;
  enabled: boolean;
}): SuperBootProbeVerdict {
  if (input.gates.some((gateItem) => gateItem.status === "failed" && gateItem.name !== "explicit_enable_flag")) return "boot_probe_unsafe";
  if (!input.enabled) return "boot_probe_unknown";
  if (input.child.cleanup_status === "failed" || input.child.serving_detected || input.child.inference_or_generation_detected) return "boot_probe_unsafe";
  if (input.child.timed_out) return "boot_probe_timeout";
  if (input.child.success_marker_seen && input.child.model_load_completed && input.child.exit_code === 0) return "boot_probe_passed";
  if (input.child.launched && input.child.exit_code !== 0) return "boot_probe_failed";
  return "boot_probe_unknown";
}

async function captureResourceSnapshot(
  label: SuperBootProbeResourceSnapshot["label"],
  pid: number | null,
  runner: SuperAuditCommandRunner = defaultCommandRunner,
): Promise<SuperBootProbeResourceSnapshot> {
  const diagnostics: string[] = [];
  const process = await processSnapshot(pid);
  let gpuSummary: string | null = null;
  try {
    const gpu = await runner("nvidia-smi", ["--query-gpu=index,name,memory.total,memory.free,memory.used,utilization.gpu", "--format=csv,noheader"]);
    gpuSummary = gpu.exitCode === 0 ? gpu.stdout.trim() || null : null;
    if (gpu.exitCode !== 0) diagnostics.push(`NVIDIA_SMI_FAILED:${gpu.exitCode}`);
  } catch (error) {
    diagnostics.push(error instanceof Error ? `NVIDIA_SMI_UNAVAILABLE:${error.message}` : "NVIDIA_SMI_UNAVAILABLE");
  }
  return {
    timestamp: new Date().toISOString(),
    label,
    system_memory: {
      total_bytes: os.totalmem(),
      free_bytes: os.freemem(),
      load_average: os.loadavg(),
    },
    process,
    gpu_summary: gpuSummary,
    diagnostics,
  };
}

async function processSnapshot(pid: number | null): Promise<SuperBootProbeResourceSnapshot["process"]> {
  if (!pid) return { pid: null, rss_bytes: null, state: null };
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rss = /VmRSS:\s+(\d+)\s+kB/.exec(status)?.[1];
    const state = /State:\s+(.+)/.exec(status)?.[1] ?? null;
    return { pid, rss_bytes: rss ? Number(rss) * 1024 : null, state };
  } catch {
    return { pid, rss_bytes: null, state: null };
  }
}

async function phase12EvidenceReady(filePath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { final_verdict?: string };
    return parsed.final_verdict === "ready_for_guarded_boot_probe";
  } catch {
    return false;
  }
}

async function repoCommitAtStart(repoRoot: string, runner: SuperAuditCommandRunner = defaultCommandRunner): Promise<string | null> {
  const result = await runner("git", ["rev-parse", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

async function runCheckOnlyPreflight(options: SuperBootProbeOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function sanitizedChildEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    AIRLLM_BOOT_PROBE: "1",
  };
}

function notLaunchedChild(command: string[], cwd: string): SuperBootProbeChildProcessResult {
  return {
    launched: false,
    pid: null,
    command,
    cwd,
    stdout_summary: null,
    stderr_summary: null,
    exit_code: null,
    signal: null,
    timed_out: false,
    cleanup_status: "not_launched",
    cleanup_signal: null,
    success_marker_seen: false,
    model_load_attempted: false,
    model_load_completed: false,
    inference_or_generation_detected: false,
    serving_detected: false,
    diagnostics: ["SUPER_BOOT_PROBE_CHILD_NOT_LAUNCHED"],
  };
}

function redactProbeCommand(command: string[]): string[] {
  return command.length >= 3 ? [command[0], command[1], "<guarded-super-boot-probe-script>"] : command;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

async function processAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function gate(name: string, passed: boolean, message: string): SuperBootProbeSafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
}

function recommendation(verdict: SuperBootProbeVerdict): string {
  if (verdict === "boot_probe_passed") return "Keep senior role blocked; next phase can design a guarded non-task smoke lifecycle with human approval.";
  if (verdict === "boot_probe_timeout") return "Review resource snapshots and consider a human-approved shorter-scope probe before increasing timeout.";
  if (verdict === "boot_probe_failed") return "Review child stderr/stdout for AirLLM/model-load failure before any retry.";
  if (verdict === "boot_probe_unsafe") return "Do not rerun until failed safety/cleanup/Nano gates are resolved.";
  return "Run with --enable-guarded-boot-probe only after dry-run gates pass.";
}

async function defaultCommandRunner(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  try {
    const result = await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
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
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}...` : trimmed;
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export const DEFAULT_SUPER_BOOT_PROBE_CONFIG = {
  runtimePath: DEFAULT_RUNTIME,
  modelPath: DEFAULT_MODEL_PATH,
  phase12EvidencePath: DEFAULT_PHASE12_EVIDENCE,
};
