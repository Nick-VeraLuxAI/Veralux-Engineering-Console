import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  resolveModelRole,
  validateModelRoleAssignment,
  type ModelRoleAssignment,
} from "../model-routing/model-role-routing";
import {
  runRuntimeSupervisorPreflight,
  type RuntimeSupervisorOptions,
  type RuntimeSupervisorReport,
} from "../runtime-supervisor/runtime-supervisor";
import type { AcceptanceThresholdVerdict } from "../prototype-loop/acceptance-threshold";
import type { PrototypeRevisionLoopResult } from "../prototype-loop/prototype-revision-loop";

export type SeniorEscalationReason =
  | "architecture_risk"
  | "security_risk"
  | "large_refactor"
  | "threshold_blocked"
  | "max_revision_rounds_reached"
  | "user_requested_senior_review"
  | "complexity_above_threshold"
  | "runtime_sensitive_change"
  | "integration_sensitive_change";

export type SeniorEscalationDryRunStatus =
  | "dry_run_blocked"
  | "not_required"
  | "blocked"
  | "ready_for_future_senior_review";

export interface SeniorEscalationPolicy {
  seniorRoleId: string;
  dryRunOnly: boolean;
  complexityThreshold: number;
  blockedSeniorStatuses: string[];
}

export interface SeniorEscalationContext {
  taskId: string;
  originalRequest: string;
  structuredSpec?: Record<string, unknown> | null;
  riskClassification?: string | null;
  acceptanceCriteria?: string[];
  acceptanceThreshold?: AcceptanceThresholdVerdict | null;
  revisionLoop?: PrototypeRevisionLoopResult | null;
  runtimeSupervisor?: RuntimeSupervisorReport | null;
  evidencePaths?: string[];
  filesChanged?: string[];
  commandsRun?: string[];
  blockingFailures?: string[];
  userRequestedSeniorReview?: boolean;
  complexityScore?: number;
  changeTags?: SeniorEscalationReason[];
}

export interface SeniorEscalationPackage {
  escalation_id: string;
  timestamp: string;
  task_id: string;
  original_request: string;
  structured_spec: Record<string, unknown> | null;
  escalation_reasons: SeniorEscalationReason[];
  risk_classification: string | null;
  acceptance_criteria: string[];
  acceptance_threshold_summary: Record<string, unknown> | null;
  revision_loop_summary: Record<string, unknown> | null;
  runtime_supervisor_summary: Record<string, unknown> | null;
  relevant_evidence_paths: string[];
  files_changed: string[];
  commands_run: string[];
  blocking_failures: string[];
  proposed_senior_review_prompt: string;
  senior_role_id: string;
  senior_role_resolution: ModelRoleAssignment;
  senior_execution_mode: "dry_run_blocked";
  safety: {
    airllm_super_used: false;
    qwen_used: false;
    fallback_used: false;
    integration_performed: false;
    senior_model_inference_performed: false;
  };
}

export interface SeniorEscalationDryRunResult {
  status: SeniorEscalationDryRunStatus;
  senior_role_id: string;
  senior_role_status: string | null;
  senior_provider: string | null;
  senior_expected_model: string | null;
  airllm_super_started: false;
  qwen_used: false;
  fallback_used: false;
  integration_performed: false;
  senior_model_inference_performed: false;
  package_path: string | null;
  evidence_path: string | null;
  blocked_reason: string | null;
  next_required_human_action: string;
}

export interface SeniorEscalationLifecycleResult {
  lifecycle_id: string;
  timestamp: string;
  status: SeniorEscalationDryRunStatus;
  senior_review_required: boolean;
  escalation_reasons: SeniorEscalationReason[];
  senior_package: SeniorEscalationPackage | null;
  senior_result: SeniorEscalationDryRunResult;
  preflight_runtime_report_path: string | null;
  postflight_runtime_report_path: string | null;
  preflight_runtime_status: string | null;
  postflight_runtime_status: string | null;
  evidence_path: string;
  fallback_used: false;
  airllm_super_used: false;
  qwen_used: false;
  integration_performed: false;
}

export interface SeniorEscalationLifecycleOptions {
  env?: NodeJS.ProcessEnv;
  policy?: Partial<SeniorEscalationPolicy>;
  evidenceRoot?: string;
  now?: () => Date;
  runtimePreflight?: () => Promise<RuntimeSupervisorReport>;
  runtimePreflightOptions?: RuntimeSupervisorOptions;
}

export const DEFAULT_SENIOR_ESCALATION_POLICY: SeniorEscalationPolicy = {
  seniorRoleId: "console_senior_worker",
  dryRunOnly: true,
  complexityThreshold: 8,
  blockedSeniorStatuses: ["blocked_unproven", "blocked_unknown_role"],
};

export function shouldRequestSeniorReview(
  context: SeniorEscalationContext,
  policy: SeniorEscalationPolicy = DEFAULT_SENIOR_ESCALATION_POLICY,
): { required: boolean; reasons: SeniorEscalationReason[] } {
  const reasons = new Set<SeniorEscalationReason>();
  const risk = (context.riskClassification ?? "").toLowerCase();
  if (risk.includes("architecture") || risk === "architectural" || context.changeTags?.includes("architecture_risk")) {
    reasons.add("architecture_risk");
  }
  if (risk.includes("security") || context.changeTags?.includes("security_risk")) {
    reasons.add("security_risk");
  }
  if (context.changeTags?.includes("large_refactor")) reasons.add("large_refactor");
  if (context.acceptanceThreshold?.status === "blocked") reasons.add("threshold_blocked");
  if (context.revisionLoop?.status === "max_rounds_reached") reasons.add("max_revision_rounds_reached");
  if (context.userRequestedSeniorReview) reasons.add("user_requested_senior_review");
  if ((context.complexityScore ?? 0) >= policy.complexityThreshold) reasons.add("complexity_above_threshold");
  if (context.changeTags?.includes("runtime_sensitive_change")) reasons.add("runtime_sensitive_change");
  if (context.changeTags?.includes("integration_sensitive_change")) reasons.add("integration_sensitive_change");
  return {
    required: reasons.size > 0,
    reasons: Array.from(reasons),
  };
}

export function createSeniorEscalationPackage(input: {
  context: SeniorEscalationContext;
  reasons: SeniorEscalationReason[];
  seniorRole: ModelRoleAssignment;
  timestamp: string;
}): SeniorEscalationPackage {
  const escalationId = seniorEscalationId(input.context.taskId, input.timestamp);
  return {
    escalation_id: escalationId,
    timestamp: input.timestamp,
    task_id: input.context.taskId,
    original_request: input.context.originalRequest,
    structured_spec: input.context.structuredSpec ?? null,
    escalation_reasons: input.reasons,
    risk_classification: input.context.riskClassification ?? null,
    acceptance_criteria: input.context.acceptanceCriteria ?? [],
    acceptance_threshold_summary: acceptanceThresholdSummary(input.context.acceptanceThreshold ?? null),
    revision_loop_summary: revisionLoopSummary(input.context.revisionLoop ?? null),
    runtime_supervisor_summary: runtimeSupervisorSummary(input.context.runtimeSupervisor ?? null),
    relevant_evidence_paths: input.context.evidencePaths ?? [],
    files_changed: input.context.filesChanged ?? [],
    commands_run: input.context.commandsRun ?? [],
    blocking_failures: input.context.blockingFailures ?? input.context.acceptanceThreshold?.blocking_failures ?? [],
    proposed_senior_review_prompt: seniorReviewPrompt(input.context, input.reasons),
    senior_role_id: input.seniorRole.roleId,
    senior_role_resolution: input.seniorRole,
    senior_execution_mode: "dry_run_blocked",
    safety: {
      airllm_super_used: false,
      qwen_used: false,
      fallback_used: false,
      integration_performed: false,
      senior_model_inference_performed: false,
    },
  };
}

export async function runSeniorEscalationDryRun(input: {
  context: SeniorEscalationContext;
  reasons: SeniorEscalationReason[];
  seniorRole: ModelRoleAssignment;
  timestamp: string;
  packagePath: string;
  evidencePath: string;
  policy?: SeniorEscalationPolicy;
}): Promise<{ package: SeniorEscalationPackage; result: SeniorEscalationDryRunResult }> {
  const policy = input.policy ?? DEFAULT_SENIOR_ESCALATION_POLICY;
  const diagnostics = validateModelRoleAssignment(input.seniorRole);
  const blockedReason = dryRunBlockedReason(input.seniorRole, diagnostics, policy);
  const pkg = createSeniorEscalationPackage({
    context: input.context,
    reasons: input.reasons,
    seniorRole: input.seniorRole,
    timestamp: input.timestamp,
  });
  await writeJson(input.packagePath, pkg);

  const status: SeniorEscalationDryRunStatus = blockedReason
    ? input.seniorRole.status === "blocked_unproven"
      ? "dry_run_blocked"
      : "blocked"
    : "ready_for_future_senior_review";
  return {
    package: pkg,
    result: {
      status,
      senior_role_id: input.seniorRole.roleId,
      senior_role_status: input.seniorRole.status,
      senior_provider: input.seniorRole.provider,
      senior_expected_model: input.seniorRole.model,
      airllm_super_started: false,
      qwen_used: false,
      fallback_used: false,
      integration_performed: false,
      senior_model_inference_performed: false,
      package_path: input.packagePath,
      evidence_path: input.evidencePath,
      blocked_reason: blockedReason,
      next_required_human_action: blockedReason
        ? "Keep senior/Super dry-run only until AirLLM/Super compatibility is explicitly proven and approved."
        : "Future phase may run a compatibility proof before any real senior inference.",
    },
  };
}

export async function runSeniorEscalationLifecycle(
  context: SeniorEscalationContext,
  options: SeniorEscalationLifecycleOptions = {},
): Promise<SeniorEscalationLifecycleResult> {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const policy = { ...DEFAULT_SENIOR_ESCALATION_POLICY, ...options.policy };
  const evidenceRoot = options.evidenceRoot ?? "evidence/senior-escalation";
  const lifecycleId = `phase-7-senior-escalation-dry-run-${context.taskId}-${safeTimestamp(timestamp)}`;
  const evidencePath = path.join(evidenceRoot, `${lifecycleId}.json`);
  const packagePath = path.join(evidenceRoot, `${lifecycleId}-package.json`);
  const preflight = await runCheckOnlyPreflight(options);
  const contextWithRuntime = {
    ...context,
    runtimeSupervisor: context.runtimeSupervisor ?? preflight,
  };
  const decision = shouldRequestSeniorReview(contextWithRuntime, policy);
  const seniorRole = resolveModelRole(policy.seniorRoleId, options.env);

  let seniorPackage: SeniorEscalationPackage | null = null;
  let seniorResult: SeniorEscalationDryRunResult;
  if (!decision.required) {
    seniorResult = {
      status: "not_required",
      senior_role_id: seniorRole.roleId,
      senior_role_status: seniorRole.status,
      senior_provider: seniorRole.provider,
      senior_expected_model: seniorRole.model,
      airllm_super_started: false,
      qwen_used: false,
      fallback_used: false,
      integration_performed: false,
      senior_model_inference_performed: false,
      package_path: null,
      evidence_path: evidencePath,
      blocked_reason: null,
      next_required_human_action: "No senior review is needed for this deterministic Phase 7 case.",
    };
  } else {
    const dryRun = await runSeniorEscalationDryRun({
      context: contextWithRuntime,
      reasons: decision.reasons,
      seniorRole,
      timestamp,
      packagePath,
      evidencePath,
      policy,
    });
    seniorPackage = dryRun.package;
    seniorResult = dryRun.result;
  }

  const postflight = await runCheckOnlyPreflight(options);
  const result: SeniorEscalationLifecycleResult = {
    lifecycle_id: lifecycleId,
    timestamp,
    status: seniorResult.status,
    senior_review_required: decision.required,
    escalation_reasons: decision.reasons,
    senior_package: seniorPackage,
    senior_result: seniorResult,
    preflight_runtime_report_path: preflight.evidence_path,
    postflight_runtime_report_path: postflight.evidence_path,
    preflight_runtime_status: preflight.status,
    postflight_runtime_status: postflight.status,
    evidence_path: evidencePath,
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
  };
  await writeJson(evidencePath, result);
  return result;
}

async function runCheckOnlyPreflight(options: SeniorEscalationLifecycleOptions): Promise<RuntimeSupervisorReport> {
  if (options.runtimePreflight) return options.runtimePreflight();
  return runRuntimeSupervisorPreflight({
    ...options.runtimePreflightOptions,
    env: options.env ?? options.runtimePreflightOptions?.env,
    recover: false,
  });
}

function dryRunBlockedReason(
  seniorRole: ModelRoleAssignment,
  diagnostics: string[],
  policy: SeniorEscalationPolicy,
): string | null {
  if (!policy.dryRunOnly) return "PHASE_7_REAL_SENIOR_EXECUTION_NOT_ALLOWED";
  if (seniorRole.status === "blocked_unknown_role") return "PHASE_7_SENIOR_ROLE_UNKNOWN_FAIL_CLOSED";
  if (!seniorRole.provider || !seniorRole.model) return "PHASE_7_SENIOR_ROLE_INCOMPLETE_FAIL_CLOSED";
  if (diagnostics.length > 0) return diagnostics.join(";");
  if (policy.blockedSeniorStatuses.includes(seniorRole.status)) {
    return "PHASE_7_SENIOR_ROLE_BLOCKED_UNPROVEN_DRY_RUN_ONLY";
  }
  return null;
}

function seniorEscalationId(taskId: string, timestamp: string): string {
  return `senior-escalation-${taskId}-${safeTimestamp(timestamp)}`;
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function acceptanceThresholdSummary(threshold: AcceptanceThresholdVerdict | null): Record<string, unknown> | null {
  if (!threshold) return null;
  return {
    status: threshold.status,
    ready: threshold.ready,
    failed_gates: threshold.failed_gates,
    blocked_gates: threshold.blocked_gates,
    blocking_failures: threshold.blocking_failures,
    summary: threshold.summary,
  };
}

function revisionLoopSummary(revisionLoop: PrototypeRevisionLoopResult | null): Record<string, unknown> | null {
  if (!revisionLoop) return null;
  return {
    status: revisionLoop.status,
    round_count: revisionLoop.round_count,
    max_rounds: revisionLoop.max_rounds,
    final_readiness_verdict: revisionLoop.final_readiness_verdict,
    final_evidence_path: revisionLoop.final_evidence_path,
    blocking_failures: revisionLoop.blocking_failures,
  };
}

function runtimeSupervisorSummary(report: RuntimeSupervisorReport | null): Record<string, unknown> | null {
  if (!report) return null;
  return {
    status: report.status,
    evidence_path: report.evidence_path,
    required_roles: report.required_roles,
    role_health: report.role_health.map((health) => ({
      role_id: health.role_id,
      status: health.status,
      runtime_required: health.runtime_required,
      recovery_attempted: health.recovery_attempted,
    })),
  };
}

function seniorReviewPrompt(
  context: SeniorEscalationContext,
  reasons: SeniorEscalationReason[],
): string {
  return [
    "Dry-run senior review package only. Do not execute model inference.",
    `Task: ${context.taskId}`,
    `Reasons: ${reasons.join(", ")}`,
    `Request: ${context.originalRequest}`,
    `Risk: ${context.riskClassification ?? "unspecified"}`,
    "Review acceptance threshold, revision history, runtime status, changed files, and blocking failures before recommending a future approved senior review path.",
  ].join("\n");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
