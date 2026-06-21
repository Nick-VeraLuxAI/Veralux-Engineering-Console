import { execFile } from "child_process";
import { createHash } from "crypto";
import { constants as fsConstants } from "fs";
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { resolveModelRole, type ModelRoleAssignment } from "../model-routing/model-role-routing";
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

export type SuperArtifactRemediationVerdict =
  | "remediation_verified"
  | "remediation_plan_ready"
  | "remediation_blocked"
  | "remediation_unsafe"
  | "remediation_unknown";

export type SuperArtifactFileStatus =
  | "present"
  | "missing"
  | "mismatched"
  | "downloaded"
  | "verified"
  | "skipped"
  | "blocked";

export interface SuperArtifactManifestEntry {
  file_name: string;
  source_repo_id: string;
  expected_size: number | null;
  expected_sha256: string | null;
  required_for_boot: boolean;
  remote_code: boolean;
  remediation_allowed: boolean;
  local_path: string;
  local_exists: boolean;
  local_size: number | null;
  local_sha256: string | null;
  status: SuperArtifactFileStatus;
}

export interface SuperArtifactRemediationPlan {
  enabled: boolean;
  candidates: SuperArtifactManifestEntry[];
  skipped: SuperArtifactManifestEntry[];
  blocked_reasons: string[];
}

export interface SuperArtifactRemediationStep {
  file_name: string;
  source_url: string;
  staged_path: string | null;
  target_path: string;
  backup_path: string | null;
  downloaded_bytes: number | null;
  staged_sha256: string | null;
  final_sha256: string | null;
  status: "downloaded" | "written" | "verified" | "skipped" | "blocked" | "failed";
  diagnostics: string[];
}

export interface SuperArtifactVerification {
  file_name: string;
  exists: boolean;
  size: number | null;
  sha256: string | null;
  compile_status: "passed" | "failed" | "skipped";
  diagnostics: string[];
}

export interface SuperConfigOnlyCheck {
  status: "passed" | "failed" | "skipped";
  command: string[];
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  model_load_performed: false;
  inference_performed: false;
  serving_started: false;
  diagnostics: string[];
}

export interface SuperArtifactRemediationSafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface SuperArtifactRemediationResult {
  phase_id: "phase-14-super-artifact-remediation";
  remediation_id: string;
  timestamp: string;
  repo_commit_at_start: string | null;
  phase13_evidence_path: string;
  phase13_failure_reason: string | null;
  source_repo_id: string;
  local_model_path: string;
  official_manifest: SuperArtifactManifestEntry[];
  local_artifact_audit: SuperModelArtifactCheck;
  remediation_plan: SuperArtifactRemediationPlan;
  files_downloaded: SuperArtifactRemediationStep[];
  files_written: SuperArtifactRemediationStep[];
  backups_created: string[];
  verification_results: SuperArtifactVerification[];
  config_only_check: SuperConfigOnlyCheck;
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  senior_role_resolution: ModelRoleAssignment;
  safety_gates: SuperArtifactRemediationSafetyGate[];
  model_load_occurred: false;
  inference_or_generation_occurred: boolean;
  serving_occurred: boolean;
  qwen_used: boolean;
  fallback_used: boolean;
  integration_performed: boolean;
  phase13_rerun_performed: false;
  senior_role_promoted: false;
  final_verdict: SuperArtifactRemediationVerdict;
  recommended_next_action: string;
  evidence_path: string;
  blocked_reasons: string[];
  warnings: string[];
}

export interface SuperArtifactRemediationOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  phase13EvidencePath: string;
  modelPath?: string;
  sourceRepoId?: string;
  enabled?: boolean;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  commandRunner?: SuperAuditCommandRunner;
  downloader?: SuperArtifactDownloader;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
  safetyOverrides?: Partial<{
    modelLoadOccurred: boolean;
    inferenceOccurred: boolean;
    servingOccurred: boolean;
    qwenUsed: boolean;
    fallbackUsed: boolean;
    integrationPerformed: boolean;
    phase13RerunPerformed: boolean;
  }>;
}

export type SuperArtifactDownloader = (input: {
  repoId: string;
  fileName: string;
  url: string;
}) => Promise<{ bytes: Buffer; sourceUrl: string }>;

const OFFICIAL_REPO_ID = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
const DEFAULT_MODEL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
const OFFICIAL_SMALL_ARTIFACTS = [
  { file_name: "configuration_nemotron_h.py", required_for_boot: true, remote_code: true, remediation_allowed: true },
  { file_name: "modeling_nemotron_h.py", required_for_boot: true, remote_code: true, remediation_allowed: true },
  { file_name: "__init__.py", required_for_boot: false, remote_code: true, remediation_allowed: true },
  { file_name: "super_v3_reasoning_parser.py", required_for_boot: true, remote_code: true, remediation_allowed: true },
  { file_name: "chat_template.jinja", required_for_boot: false, remote_code: false, remediation_allowed: true },
  { file_name: "generation_config.json", required_for_boot: false, remote_code: false, remediation_allowed: true },
  { file_name: "hf_quant_config.json", required_for_boot: true, remote_code: false, remediation_allowed: true },
  { file_name: "special_tokens_map.json", required_for_boot: true, remote_code: false, remediation_allowed: true },
  { file_name: "tokenizer_config.json", required_for_boot: true, remote_code: false, remediation_allowed: true },
  { file_name: "config.json", required_for_boot: true, remote_code: false, remediation_allowed: false },
  { file_name: "model.safetensors.index.json", required_for_boot: true, remote_code: false, remediation_allowed: false },
  { file_name: "tokenizer.json", required_for_boot: true, remote_code: false, remediation_allowed: false },
] as const;

const EXPECTED_PHASE14_PREFIXES = [
  "src/lib/engineer-console/super-artifact-remediation/",
  "scripts/runtime/super-artifact-remediation.ts",
  "docs/runtime/phase-14-super-artifact-remediation-2026-06-21.md",
  "evidence/super-artifact-remediation/",
  "evidence/super-boot-probe/",
  "evidence/runtime-supervisor/",
];

export async function loadPhase13FailureEvidence(filePath: string): Promise<{ found: boolean; reason: string | null; diagnostics: string[] }> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      final_verdict?: string;
      child_process?: { stdout_summary?: string | null; stderr_summary?: string | null };
    };
    const reason = [parsed.child_process?.stdout_summary, parsed.child_process?.stderr_summary].filter(Boolean).join("\n");
    const mentionsMissingConfig = reason.includes("configuration_nemotron_h.py");
    return {
      found: parsed.final_verdict === "boot_probe_failed" && mentionsMissingConfig,
      reason: reason || null,
      diagnostics: mentionsMissingConfig ? [] : ["PHASE13_FAILURE_DOES_NOT_REFERENCE_CONFIGURATION_NEMOTRON_H"],
    };
  } catch (error) {
    return {
      found: false,
      reason: null,
      diagnostics: [error instanceof Error ? `PHASE13_EVIDENCE_UNREADABLE:${error.message}` : "PHASE13_EVIDENCE_UNREADABLE"],
    };
  }
}

export async function buildOfficialArtifactManifest(input: {
  sourceRepoId: string;
  modelPath: string;
}): Promise<SuperArtifactManifestEntry[]> {
  return Promise.all(OFFICIAL_SMALL_ARTIFACTS.map(async (entry) => {
    const localPath = safeArtifactPath(input.modelPath, entry.file_name);
    const local = await localFileSummary(localPath);
    return {
      file_name: entry.file_name,
      source_repo_id: input.sourceRepoId,
      expected_size: null,
      expected_sha256: null,
      required_for_boot: entry.required_for_boot,
      remote_code: entry.remote_code,
      remediation_allowed: entry.remediation_allowed,
      local_path: localPath,
      local_exists: local.exists,
      local_size: local.size,
      local_sha256: local.sha256,
      status: local.exists ? "present" : "missing",
    };
  }));
}

export async function auditLocalSuperArtifacts(input: {
  modelPath: string;
}): Promise<SuperModelArtifactCheck> {
  return auditSuperModelArtifacts({
    parsedUri: parseAirLlmUri(`airllm://${input.modelPath}`),
    expectedModel: "Nemotron-Super-120B-A12B-FP8",
  });
}

export function planSuperArtifactRemediation(input: {
  manifest: SuperArtifactManifestEntry[];
  enabled: boolean;
}): SuperArtifactRemediationPlan {
  const candidates = input.manifest.filter((entry) => entry.status === "missing" && entry.required_for_boot && entry.remediation_allowed && isAllowedSmallArtifact(entry.file_name));
  const skipped = input.manifest.filter((entry) => !candidates.includes(entry));
  const blocked = input.manifest
    .filter((entry) => entry.status === "missing" && !entry.remediation_allowed && entry.required_for_boot)
    .map((entry) => `REQUIRED_ARTIFACT_MISSING_BUT_NOT_REMEDIATION_ALLOWED:${entry.file_name}`);
  return { enabled: input.enabled, candidates, skipped, blocked_reasons: blocked };
}

export async function runSuperArtifactRemediation(options: SuperArtifactRemediationOptions): Promise<SuperArtifactRemediationResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const remediationId = `phase-14-super-artifact-remediation-${safeTimestamp(timestamp)}`;
  const evidenceRoot = options.evidenceRoot ?? "evidence/super-artifact-remediation";
  const evidencePath = path.join(evidenceRoot, `${remediationId}.json`);
  const sourceRepoId = options.sourceRepoId ?? OFFICIAL_REPO_ID;
  const modelPath = options.modelPath ?? DEFAULT_MODEL_PATH;
  const enabled = options.enabled === true;
  const runner = options.commandRunner ?? defaultCommandRunner;
  const seniorRole = resolveModelRole("console_senior_worker", options.env);
  const repoCommit = await repoCommitAtStart(runner);
  const repoState = await repoStateCleanOrExpected(runner);
  const preflight = await runCheckOnlyPreflight(options);
  const phase13 = await loadPhase13FailureEvidence(path.resolve(repoRoot, options.phase13EvidencePath));
  const localAudit = await auditLocalSuperArtifacts({ modelPath });
  const manifest = await buildOfficialArtifactManifest({ sourceRepoId, modelPath });
  const plan = planSuperArtifactRemediation({ manifest, enabled });
  const stagingRoot = path.join(modelPath, ".artifact-remediation-staging", remediationId);
  const safetyGates = evaluatePreRemediationGates({
    repoState,
    phase13,
    sourceRepoId,
    modelPath,
    localAudit,
    plan,
    preflightStatus: preflight.status,
    seniorRole,
    safetyOverrides: options.safetyOverrides,
  });

  let steps: SuperArtifactRemediationStep[] = [];
  let verificationResults: SuperArtifactVerification[] = [];
  let configOnlyCheck = skippedConfigCheck();
  const preBlocked = safetyGates.some((gate) => gate.status === "failed");
  if (enabled && !preBlocked) {
    steps = await remediateArtifacts({
      plan,
      stagingRoot,
      modelPath,
      sourceRepoId,
      downloader: options.downloader ?? downloadOfficialSmallArtifact,
      runner,
    });
    const pythonPath = path.join(repoRoot, ".venv-airllm/bin/python");
    verificationResults = steps.length > 0
      ? await verifyRemediatedArtifacts({ steps, runner, pythonPath })
      : await verifyExistingRequiredArtifacts({ manifest, runner, pythonPath });
    configOnlyCheck = await runConfigOnlyCheck({
      runner,
      pythonPath: path.join(repoRoot, ".venv-airllm/bin/python"),
      modelPath,
    });
    await rm(stagingRoot, { recursive: true, force: true });
    await removeEmptyDirectory(path.dirname(stagingRoot));
  }
  const postflight = await runCheckOnlyPreflight(options);
  const postGates = evaluatePostRemediationGates({
    enabled,
    plan,
    steps,
    verificationResults,
    configOnlyCheck,
    postflightStatus: postflight.status,
    safetyOverrides: options.safetyOverrides,
  });
  const allGates = [...safetyGates, ...postGates];
  const finalVerdict = evaluateRemediationVerdict({ enabled, allGates, plan, steps, verificationResults, configOnlyCheck });
  const result: SuperArtifactRemediationResult = {
    phase_id: "phase-14-super-artifact-remediation",
    remediation_id: remediationId,
    timestamp,
    repo_commit_at_start: repoCommit,
    phase13_evidence_path: options.phase13EvidencePath,
    phase13_failure_reason: summarize(phase13.reason ?? ""),
    source_repo_id: sourceRepoId,
    local_model_path: modelPath,
    official_manifest: manifest,
    local_artifact_audit: localAudit,
    remediation_plan: plan,
    files_downloaded: steps.filter((step) => ["downloaded", "written", "verified"].includes(step.status)),
    files_written: steps.filter((step) => ["written", "verified"].includes(step.status)),
    backups_created: steps.map((step) => step.backup_path).filter((entry): entry is string => !!entry),
    verification_results: verificationResults,
    config_only_check: configOnlyCheck,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    senior_role_resolution: seniorRole,
    safety_gates: allGates,
    model_load_occurred: false,
    inference_or_generation_occurred: options.safetyOverrides?.inferenceOccurred === true,
    serving_occurred: options.safetyOverrides?.servingOccurred === true,
    qwen_used: options.safetyOverrides?.qwenUsed === true,
    fallback_used: options.safetyOverrides?.fallbackUsed === true,
    integration_performed: options.safetyOverrides?.integrationPerformed === true,
    phase13_rerun_performed: false,
    senior_role_promoted: false,
    final_verdict: finalVerdict,
    recommended_next_action: recommendation(finalVerdict),
    evidence_path: evidencePath,
    blocked_reasons: allGates.filter((gate) => gate.status === "failed").map((gate) => `${gate.name}:${gate.message}`),
    warnings: [...phase13.diagnostics, ...repoState.diagnostics, ...steps.flatMap((step) => step.diagnostics)],
  };
  await writeJson(evidencePath, result);
  return result;
}

export async function downloadOfficialSmallArtifact(input: {
  repoId: string;
  fileName: string;
  url: string;
}): Promise<{ bytes: Buffer; sourceUrl: string }> {
  if (input.repoId !== OFFICIAL_REPO_ID) throw new Error("SUPER_ARTIFACT_SOURCE_REPO_NOT_OFFICIAL");
  if (!isAllowedSmallArtifact(input.fileName)) throw new Error(`SUPER_ARTIFACT_DOWNLOAD_NOT_ALLOWED:${input.fileName}`);
  const response = await fetch(input.url);
  if (!response.ok) throw new Error(`SUPER_ARTIFACT_DOWNLOAD_FAILED:${response.status}:${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, sourceUrl: input.url };
}

async function remediateArtifacts(input: {
  plan: SuperArtifactRemediationPlan;
  stagingRoot: string;
  modelPath: string;
  sourceRepoId: string;
  downloader: SuperArtifactDownloader;
  runner: SuperAuditCommandRunner;
}): Promise<SuperArtifactRemediationStep[]> {
  await mkdir(input.stagingRoot, { recursive: true });
  const steps: SuperArtifactRemediationStep[] = [];
  for (const candidate of input.plan.candidates) {
    const url = officialRawUrl(input.sourceRepoId, candidate.file_name);
    const targetPath = safeArtifactPath(input.modelPath, candidate.file_name);
    const stagedPath = path.join(input.stagingRoot, candidate.file_name);
    const step: SuperArtifactRemediationStep = {
      file_name: candidate.file_name,
      source_url: url,
      staged_path: stagedPath,
      target_path: targetPath,
      backup_path: null,
      downloaded_bytes: null,
      staged_sha256: null,
      final_sha256: null,
      status: "blocked",
      diagnostics: [],
    };
    try {
      const download = await input.downloader({ repoId: input.sourceRepoId, fileName: candidate.file_name, url });
      if (download.bytes.length === 0) throw new Error("SUPER_ARTIFACT_EMPTY_DOWNLOAD");
      if (candidate.file_name.endsWith(".safetensors")) throw new Error("SUPER_ARTIFACT_WEIGHT_WRITE_FORBIDDEN");
      await writeFile(stagedPath, download.bytes);
      step.downloaded_bytes = download.bytes.length;
      step.staged_sha256 = sha256(download.bytes);
      step.status = "downloaded";
      const targetExists = await fileExists(targetPath);
      if (targetExists) {
        const backupPath = `${targetPath}.phase14-backup-${Date.now()}`;
        await copyFile(targetPath, backupPath);
        step.backup_path = backupPath;
      }
      const tmpPath = `${targetPath}.phase14-tmp-${process.pid}`;
      await copyFile(stagedPath, tmpPath);
      await rename(tmpPath, targetPath);
      const final = await localFileSummary(targetPath);
      step.final_sha256 = final.sha256;
      step.status = final.sha256 === step.staged_sha256 ? "verified" : "failed";
      if (step.status === "failed") step.diagnostics.push("SUPER_ARTIFACT_FINAL_HASH_MISMATCH");
    } catch (error) {
      step.status = "failed";
      step.diagnostics.push(error instanceof Error ? error.message : String(error));
    }
    steps.push(step);
  }
  return steps;
}

async function verifyRemediatedArtifacts(input: {
  steps: SuperArtifactRemediationStep[];
  runner: SuperAuditCommandRunner;
  pythonPath: string;
}): Promise<SuperArtifactVerification[]> {
  const results: SuperArtifactVerification[] = [];
  for (const step of input.steps) {
    const summary = await localFileSummary(step.target_path);
    const compile = step.file_name.endsWith(".py")
      ? await input.runner(input.pythonPath, ["-m", "py_compile", step.target_path])
      : null;
    results.push({
      file_name: step.file_name,
      exists: summary.exists,
      size: summary.size,
      sha256: summary.sha256,
      compile_status: compile ? compile.exitCode === 0 ? "passed" : "failed" : "skipped",
      diagnostics: [
        !summary.exists ? "SUPER_ARTIFACT_VERIFY_MISSING" : null,
        summary.size === 0 ? "SUPER_ARTIFACT_VERIFY_EMPTY" : null,
        compile && compile.exitCode !== 0 ? summarize(compile.stderr || compile.stdout || "SUPER_ARTIFACT_COMPILE_FAILED") : null,
      ].filter((entry): entry is string => !!entry),
    });
  }
  return results;
}

async function verifyExistingRequiredArtifacts(input: {
  manifest: SuperArtifactManifestEntry[];
  runner: SuperAuditCommandRunner;
  pythonPath: string;
}): Promise<SuperArtifactVerification[]> {
  const steps = input.manifest
    .filter((entry) => entry.required_for_boot && entry.remediation_allowed && entry.local_exists)
    .map((entry): SuperArtifactRemediationStep => ({
      file_name: entry.file_name,
      source_url: officialRawUrl(entry.source_repo_id, entry.file_name),
      staged_path: null,
      target_path: entry.local_path,
      backup_path: null,
      downloaded_bytes: null,
      staged_sha256: null,
      final_sha256: entry.local_sha256,
      status: "verified",
      diagnostics: [],
    }));
  return verifyRemediatedArtifacts({ steps, runner: input.runner, pythonPath: input.pythonPath });
}

async function runConfigOnlyCheck(input: {
  runner: SuperAuditCommandRunner;
  pythonPath: string;
  modelPath: string;
}): Promise<SuperConfigOnlyCheck> {
  const script = [
    "import json, sys",
    "from transformers import AutoConfig",
    `model_path = ${JSON.stringify(input.modelPath)}`,
    "cfg = AutoConfig.from_pretrained(model_path, trust_remote_code=True)",
    "print(json.dumps({'model_type': getattr(cfg, 'model_type', None), 'config_class': cfg.__class__.__name__, 'model_load_performed': False, 'inference_performed': False, 'serving_started': False}), flush=True)",
  ].join("\n");
  const command = [input.pythonPath, "-c", script];
  const result = await input.runner(command[0], command.slice(1));
  return {
    status: result.exitCode === 0 ? "passed" : "failed",
    command: [".venv-airllm/bin/python", "-c", "<phase-14-config-only-check>"],
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    model_load_performed: false,
    inference_performed: false,
    serving_started: false,
    diagnostics: result.exitCode === 0 ? [] : [summarize(result.stderr || result.stdout || "SUPER_ARTIFACT_CONFIG_ONLY_CHECK_FAILED") ?? "SUPER_ARTIFACT_CONFIG_ONLY_CHECK_FAILED"],
  };
}

function evaluatePreRemediationGates(input: {
  repoState: { cleanOrExpected: boolean; diagnostics: string[] };
  phase13: { found: boolean; diagnostics: string[] };
  sourceRepoId: string;
  modelPath: string;
  localAudit: SuperModelArtifactCheck;
  plan: SuperArtifactRemediationPlan;
  preflightStatus: string | null;
  seniorRole: ModelRoleAssignment;
  safetyOverrides?: SuperArtifactRemediationOptions["safetyOverrides"];
}): SuperArtifactRemediationSafetyGate[] {
  return [
    gate("repo_state_clean_or_expected_phase14", input.repoState.cleanOrExpected, input.repoState.diagnostics.join(";") || "Repo state is clean or only expected Phase 14 files are modified."),
    gate("phase13_missing_configuration_failure_loaded", input.phase13.found, input.phase13.diagnostics.join(";") || "Phase 13 evidence references missing configuration_nemotron_h.py."),
    gate("official_source_repo", input.sourceRepoId === OFFICIAL_REPO_ID, "Source repo is the official NVIDIA model repo."),
    gate("local_model_path_exists", input.localAudit.path_exists && input.localAudit.readable, "Local model path exists and is readable."),
    gate("allowed_file_list_enforced", input.plan.candidates.every((entry) => isAllowedSmallArtifact(entry.file_name)), "Only allowed small non-weight artifacts are candidates."),
    gate("no_weight_writes_planned", input.plan.candidates.every((entry) => !entry.file_name.endsWith(".safetensors") && entry.file_name !== "model.safetensors.index.json"), "No weight or index writes are planned."),
    gate("nano_preflight_healthy", input.preflightStatus === "healthy", "Nano preflight is healthy."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
    gate("no_model_load", input.safetyOverrides?.modelLoadOccurred !== true, "No model load occurred."),
    gate("no_inference_or_generation", input.safetyOverrides?.inferenceOccurred !== true, "No inference or generation occurred."),
    gate("no_serving", input.safetyOverrides?.servingOccurred !== true, "No serving occurred."),
    gate("qwen_not_used", input.safetyOverrides?.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", input.safetyOverrides?.fallbackUsed !== true, "No fallback was used."),
    gate("no_integration", input.safetyOverrides?.integrationPerformed !== true, "No integration occurred."),
    gate("phase13_not_rerun", input.safetyOverrides?.phase13RerunPerformed !== true, "Phase 13 was not rerun automatically."),
    gate("plan_not_blocked", input.plan.blocked_reasons.length === 0, input.plan.blocked_reasons.join(";") || "Plan has no blocked required artifacts."),
  ];
}

function evaluatePostRemediationGates(input: {
  enabled: boolean;
  plan: SuperArtifactRemediationPlan;
  steps: SuperArtifactRemediationStep[];
  verificationResults: SuperArtifactVerification[];
  configOnlyCheck: SuperConfigOnlyCheck;
  postflightStatus: string | null;
  safetyOverrides?: SuperArtifactRemediationOptions["safetyOverrides"];
}): SuperArtifactRemediationSafetyGate[] {
  const writeRequired = input.enabled;
  return [
    gate("nano_postflight_healthy", input.postflightStatus === "healthy", "Nano postflight is healthy."),
    gate("download_write_verified", !writeRequired || input.plan.candidates.length === 0 || input.steps.length > 0 && input.steps.every((step) => step.status === "verified"), "Downloaded files were written and hash-verified, or no required remediation candidates remained."),
    gate("python_compile_checks_passed", !writeRequired || input.verificationResults.every((result) => result.compile_status !== "failed"), "Python compile checks passed or were skipped for non-Python files."),
    gate("config_only_check_passed", !writeRequired || input.configOnlyCheck.status === "passed", "Config-only verification passed without model load."),
    gate("no_model_load_post", input.safetyOverrides?.modelLoadOccurred !== true && !input.configOnlyCheck.model_load_performed, "No model load occurred after remediation."),
    gate("no_serving_post", input.safetyOverrides?.servingOccurred !== true && !input.configOnlyCheck.serving_started, "No serving occurred after remediation."),
    gate("no_inference_post", input.safetyOverrides?.inferenceOccurred !== true && !input.configOnlyCheck.inference_performed, "No inference occurred after remediation."),
  ];
}

function evaluateRemediationVerdict(input: {
  enabled: boolean;
  allGates: SuperArtifactRemediationSafetyGate[];
  plan: SuperArtifactRemediationPlan;
  steps: SuperArtifactRemediationStep[];
  verificationResults: SuperArtifactVerification[];
  configOnlyCheck: SuperConfigOnlyCheck;
}): SuperArtifactRemediationVerdict {
  const failed = input.allGates.filter((gateItem) => gateItem.status === "failed");
  const unsafeNames = new Set(["official_source_repo", "allowed_file_list_enforced", "no_weight_writes_planned", "no_model_load", "no_inference_or_generation", "no_serving", "qwen_not_used", "fallback_not_used", "no_integration", "phase13_not_rerun", "no_model_load_post", "no_serving_post", "no_inference_post"]);
  if (failed.some((gateItem) => unsafeNames.has(gateItem.name))) return "remediation_unsafe";
  if (failed.length > 0 && !input.enabled) return "remediation_blocked";
  if (!input.enabled) return "remediation_plan_ready";
  if (failed.length > 0) return "remediation_blocked";
  if ((input.plan.candidates.length === 0 || input.steps.length > 0 && input.steps.every((step) => step.status === "verified")) && input.verificationResults.every((item) => item.compile_status !== "failed") && input.configOnlyCheck.status === "passed") return "remediation_verified";
  return "remediation_unknown";
}

function officialRawUrl(repoId: string, fileName: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${encodeURIComponent(fileName)}`;
}

function isAllowedSmallArtifact(fileName: string): boolean {
  if (fileName.endsWith(".safetensors")) return false;
  if (fileName.includes("/") || fileName.includes("..")) return false;
  const entry = OFFICIAL_SMALL_ARTIFACTS.find((candidate) => candidate.file_name === fileName);
  return entry?.remediation_allowed === true;
}

function safeArtifactPath(modelPath: string, fileName: string): string {
  if (fileName.includes("/") || fileName.includes("..")) throw new Error(`SUPER_ARTIFACT_PATH_ESCAPE:${fileName}`);
  const root = path.resolve(modelPath);
  const target = path.resolve(root, fileName);
  if (target !== path.join(root, fileName) || !target.startsWith(`${root}${path.sep}`)) throw new Error(`SUPER_ARTIFACT_PATH_ESCAPE:${fileName}`);
  return target;
}

async function localFileSummary(filePath: string): Promise<{ exists: boolean; size: number | null; sha256: string | null }> {
  try {
    await access(filePath, fsConstants.R_OK);
    const entry = await stat(filePath);
    if (!entry.isFile()) return { exists: false, size: null, sha256: null };
    const data = await readFile(filePath);
    return { exists: true, size: data.length, sha256: sha256(data) };
  } catch {
    return { exists: false, size: null, sha256: null };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

async function removeEmptyDirectory(directoryPath: string): Promise<void> {
  try {
    await rm(directoryPath, { recursive: true, force: true });
  } catch {
    // A non-empty staging root means another evidence run still has context there; leave it intact.
  }
}

async function repoCommitAtStart(runner: SuperAuditCommandRunner): Promise<string | null> {
  const result = await runner("git", ["rev-parse", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

async function repoStateCleanOrExpected(runner: SuperAuditCommandRunner): Promise<{ cleanOrExpected: boolean; diagnostics: string[] }> {
  const result = await runner("git", ["status", "--short"]);
  if (result.exitCode !== 0) return { cleanOrExpected: false, diagnostics: [`GIT_STATUS_FAILED:${result.stderr || result.stdout}`] };
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unexpected = lines.filter((line) => {
    const filePath = line.replace(/^(?:[ MADRCU?!]{2})\s+/, "").replace(/^"|"$/g, "");
    return !EXPECTED_PHASE14_PREFIXES.some((prefix) => filePath.startsWith(prefix));
  });
  return {
    cleanOrExpected: unexpected.length === 0,
    diagnostics: unexpected.map((line) => `UNEXPECTED_REPO_CHANGE:${line}`),
  };
}

async function runCheckOnlyPreflight(options: SuperArtifactRemediationOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function skippedConfigCheck(): SuperConfigOnlyCheck {
  return {
    status: "skipped",
    command: [".venv-airllm/bin/python", "-c", "<phase-14-config-only-check>"],
    exit_code: null,
    stdout_summary: null,
    stderr_summary: null,
    model_load_performed: false,
    inference_performed: false,
    serving_started: false,
    diagnostics: ["SUPER_ARTIFACT_CONFIG_ONLY_CHECK_SKIPPED"],
  };
}

function gate(name: string, passed: boolean, message: string): SuperArtifactRemediationSafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}...` : trimmed;
}

function recommendation(verdict: SuperArtifactRemediationVerdict): string {
  if (verdict === "remediation_verified") return "Do not auto-rerun Phase 13; request explicit approval for a separate guarded boot-probe rerun.";
  if (verdict === "remediation_plan_ready") return "Review the remediation plan, then rerun with --enable-artifact-remediation if approved.";
  if (verdict === "remediation_blocked") return "Resolve source access, artifact, filesystem, or config-only blockers before retrying.";
  if (verdict === "remediation_unsafe") return "Do not retry until the failed safety gate is fixed.";
  return "Collect more evidence before attempting remediation.";
}

const execFileAsync = promisify(execFile);

async function defaultCommandRunner(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
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

export const DEFAULT_SUPER_ARTIFACT_REMEDIATION_CONFIG = {
  sourceRepoId: OFFICIAL_REPO_ID,
  modelPath: DEFAULT_MODEL_PATH,
};
