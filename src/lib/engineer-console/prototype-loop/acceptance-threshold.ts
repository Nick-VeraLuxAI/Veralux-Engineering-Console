import path from "path";

export type AcceptanceReadinessStatus = "ready_for_user_approval" | "blocked" | "failed" | "passed_with_skips";
export type AcceptanceGateStatus = "passed" | "failed" | "blocked" | "skipped" | "not_applicable";

export interface AcceptanceCriterionStatus {
  criterion: string;
  status: "passed" | "failed" | "skipped" | "blocked" | "not_applicable";
  reason?: string;
  evidence?: string;
}

export interface AcceptanceThresholdGate {
  id: string;
  label: string;
  required: boolean;
  status: AcceptanceGateStatus;
  reason?: string;
  command?: string;
  output_summary?: string;
  evidence_ref?: string;
  category?: "acceptance" | "command" | "evidence" | "safety" | "approval" | "risk" | "role" | "workspace";
}

export interface AcceptanceCommandResult {
  command: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  exitCode?: number;
  required?: boolean;
  reason?: string;
  output_summary?: string;
}

export interface AcceptanceThresholdConfig {
  taskId: string;
  riskLevel: string | null;
  riskNotes?: string[];
  acceptanceCriteriaStatuses?: AcceptanceCriterionStatus[];
  gates?: AcceptanceThresholdGate[];
  commandResults?: AcceptanceCommandResult[];
  skippedChecks?: Array<{ id: string; label: string; required: boolean; reason?: string; command?: string }>;
  prototypeWorkspacePath: string;
  requiredTestsConfigured: boolean;
  approvalRequired: boolean;
  integrationAllowed: boolean;
  integrationPerformed: boolean;
  evidenceBundleGenerated: boolean;
  filesCreatedOrChanged: string[];
  testResults: Array<{ command: string; status: string; exitCode: number }>;
  lintTypecheckResults: Array<{ command: string; status: string; stderr?: string }>;
  diffScopeCheck: { status: string; unexpected_files?: string[]; checked_files?: string[] };
  secretScanResult: { status: string; findings?: string[] };
  modelRoleRequirements: Record<string, Record<string, unknown>>;
  fallbackUsed: boolean;
  seniorUsed: boolean;
  preExistingUnrelatedFailures?: Array<{ command: string; summary: string }>;
}

export interface AcceptanceGateResult {
  id: string;
  name: string;
  label: string;
  status: AcceptanceGateStatus;
  required: boolean;
  reason?: string;
  message: string;
  command?: string;
  output_summary?: string;
  evidence_ref?: string;
  category?: AcceptanceThresholdGate["category"];
  details?: Record<string, unknown>;
}

export interface AcceptanceThresholdVerdict {
  readiness_status: AcceptanceReadinessStatus;
  status: AcceptanceReadinessStatus;
  ready: boolean;
  approval_allowed: boolean;
  risk_level: string | null;
  risk_notes: string[];
  normalized_gates: AcceptanceThresholdGate[];
  threshold_input: {
    acceptance_criteria_statuses: AcceptanceCriterionStatus[];
    command_results: AcceptanceCommandResult[];
    skipped_checks: Array<{ id: string; label: string; required: boolean; reason?: string; command?: string }>;
    diff_scope_safety_status: string;
    secret_scan_status: string;
    evidence_generated: boolean;
    approval_policy: {
      approval_required: boolean;
      integration_allowed: boolean;
      integration_performed: boolean;
    };
    risk_level: string | null;
    risk_notes: string[];
  };
  required_gates: string[];
  passed_gates: string[];
  failed_gates: string[];
  skipped_gates: string[];
  blocked_gates: string[];
  warnings: string[];
  unresolved_issues: string[];
  blocking_reasons: string[];
  approval_required: boolean;
  integration_allowed: boolean;
  integration_performed: boolean;
  role_policy_ok: boolean;
  scope_ok: boolean;
  secret_scan_ok: boolean;
  evidence_bundle_ok: boolean;
  gate_results: AcceptanceGateResult[];
  not_applicable_gates: AcceptanceGateResult[];
  pre_existing_unrelated_failures: Array<{ command: string; summary: string }>;
  blocking_failures: string[];
  summary: string;
}

export function evaluateAcceptanceThreshold(config: AcceptanceThresholdConfig): AcceptanceThresholdVerdict {
  const gates: AcceptanceGateResult[] = [
    testGate(config),
    scopeGate(config),
    secretScanGate(config),
    noIntegrationGate(config),
    evidenceBundleGate(config),
    riskGate(config),
    approvalGate(config),
    rolePolicyGate(config),
    fallbackGate(config),
    seniorUsageGate(config),
    prototypeWorkspaceGate(config),
    ...optionalCommandGates(config),
    ...explicitCommandResultGates(config),
    ...explicitGateResults(config),
    ...skippedCheckGates(config),
  ];

  const required = gates.filter((gate) => gate.required);
  const failedRequired = required.filter((gate) => gate.status === "failed");
  const blockedRequired = required.filter((gate) => gate.status === "blocked");
  const skippedRequired = required.filter((gate) => gate.status === "skipped" || gate.status === "not_applicable");
  const skippedOptional = gates.filter((gate) => (
    !gate.required
    && (gate.status === "skipped" || gate.status === "not_applicable")
  ));
  const failedSafety = gates.filter((gate) => (
    gate.required
    && isSafetyGate(gate)
    && (gate.status === "failed" || gate.status === "blocked")
  ));
  const warnings = config.preExistingUnrelatedFailures?.map((failure) => (
    `Pre-existing unrelated failure recorded for ${failure.command}: ${failure.summary}`
  )) ?? [];
  const blockingGates = uniqueGates([...blockedRequired, ...skippedRequired, ...failedSafety]);
  const failingGates = failedRequired.filter((gate) => !blockingGates.some((blocked) => blocked.name === gate.name));
  const status: AcceptanceReadinessStatus = blockingGates.length > 0
    ? "blocked"
    : failingGates.length > 0
      ? "failed"
      : skippedOptional.length > 0
        ? "passed_with_skips"
        : "ready_for_user_approval";
  const ready = status === "ready_for_user_approval" || status === "passed_with_skips";
  const unresolved = [...blockingGates, ...failingGates].map((gate) => gate.message);
  const thresholdInput = {
    acceptance_criteria_statuses: config.acceptanceCriteriaStatuses ?? [],
    command_results: config.commandResults ?? commandResultsFromLegacyConfig(config),
    skipped_checks: config.skippedChecks ?? [],
    diff_scope_safety_status: config.diffScopeCheck.status,
    secret_scan_status: config.secretScanResult.status,
    evidence_generated: config.evidenceBundleGenerated,
    approval_policy: {
      approval_required: config.approvalRequired,
      integration_allowed: config.integrationAllowed,
      integration_performed: config.integrationPerformed,
    },
    risk_level: config.riskLevel,
    risk_notes: config.riskNotes ?? [],
  };

  return {
    readiness_status: status,
    status,
    ready,
    approval_allowed: ready && config.approvalRequired && !config.integrationAllowed && !config.integrationPerformed,
    risk_level: config.riskLevel,
    risk_notes: config.riskNotes ?? [],
    normalized_gates: gates.map(normalizeGate),
    threshold_input: thresholdInput,
    required_gates: required.map((gate) => gate.name),
    passed_gates: gates.filter((gate) => gate.status === "passed").map((gate) => gate.name),
    failed_gates: gates.filter((gate) => gate.status === "failed").map((gate) => gate.name),
    skipped_gates: gates.filter((gate) => gate.status === "skipped" || gate.status === "not_applicable").map((gate) => gate.name),
    blocked_gates: gates.filter((gate) => gate.status === "blocked").map((gate) => gate.name),
    warnings,
    unresolved_issues: unresolved,
    blocking_reasons: blockingGates.map((gate) => gate.message),
    approval_required: config.approvalRequired,
    integration_allowed: config.integrationAllowed,
    integration_performed: config.integrationPerformed,
    role_policy_ok: gatePassed(gates, "role_policy"),
    scope_ok: gatePassed(gates, "scope_check"),
    secret_scan_ok: gatePassed(gates, "secret_scan"),
    evidence_bundle_ok: gatePassed(gates, "evidence_bundle"),
    gate_results: gates,
    not_applicable_gates: gates.filter((gate) => gate.status === "not_applicable"),
    pre_existing_unrelated_failures: config.preExistingUnrelatedFailures ?? [],
    blocking_failures: blockingGates.map((gate) => gate.message),
    summary: status === "ready_for_user_approval"
      ? "All required acceptance gates passed; ready for user approval."
      : status === "passed_with_skips"
        ? "All required acceptance gates passed; optional checks were skipped with recorded reasons."
      : `Acceptance threshold ${status}; ${unresolved.length} required gate(s) need attention.`,
  };
}

function testGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  if (!config.requiredTestsConfigured) {
    return {
      id: "task_tests",
      name: "task_tests",
      label: "Task-specific tests",
      status: "not_applicable",
      required: false,
      reason: "No task-specific tests were configured for this run.",
      message: "No task-specific tests were configured for this run.",
      category: "command",
    };
  }
  const latestByCommand = new Map<string, { command: string; status: string; exitCode: number }>();
  for (const result of config.testResults) {
    latestByCommand.set(result.command, result);
  }
  const latestResults = Array.from(latestByCommand.values());
  const failed = latestResults.filter((result) => result.status !== "passed" || result.exitCode !== 0);
  return {
    id: "task_tests",
    name: "task_tests",
    label: "Task-specific tests",
    status: failed.length === 0 && latestResults.length > 0 ? "passed" : "failed",
    required: true,
    command: latestResults.map((result) => result.command).join(" && "),
    output_summary: failed.length === 0 && latestResults.length > 0 ? "Latest configured task-specific test results passed." : "Latest configured task-specific test results failed or did not run.",
    message: failed.length === 0 && latestResults.length > 0
      ? "Latest configured task-specific test results passed."
      : "Latest configured task-specific test results failed or did not run.",
    category: "command",
    details: {
      commands: latestResults.map((result) => result.command),
      historical_result_count: config.testResults.length,
    },
  };
}

function scopeGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const unexpected = config.diffScopeCheck.unexpected_files ?? [];
  return {
    id: "scope_check",
    name: "scope_check",
    label: "Diff scope safety check",
    status: config.diffScopeCheck.status === "passed" && unexpected.length === 0 ? "passed" : "blocked",
    required: true,
    reason: unexpected.length === 0 ? undefined : "Changed files escaped the allowed prototype scope.",
    message: unexpected.length === 0 ? "Changed files stayed inside the allowed prototype scope." : "Changed files escaped the allowed prototype scope.",
    category: "safety",
    details: { unexpected_files: unexpected },
  };
}

function secretScanGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const findings = config.secretScanResult.findings ?? [];
  return {
    id: "secret_scan",
    name: "secret_scan",
    label: "Secret scan",
    status: config.secretScanResult.status === "passed" && findings.length === 0 ? "passed" : "blocked",
    required: true,
    reason: findings.length === 0 ? undefined : "Secret-like patterns were found.",
    message: findings.length === 0 ? "No obvious secret patterns were found." : "Secret-like patterns were found.",
    category: "safety",
    details: { findings },
  };
}

function noIntegrationGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "no_integration",
    name: "no_integration",
    label: "No integration before approval",
    status: config.integrationPerformed ? "blocked" : "passed",
    required: true,
    reason: config.integrationPerformed ? "Integration occurred before approval." : undefined,
    message: config.integrationPerformed ? "Integration occurred before approval." : "No integration occurred before approval.",
    category: "safety",
  };
}

function evidenceBundleGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "evidence_bundle",
    name: "evidence_bundle",
    label: "Evidence bundle generated",
    status: config.evidenceBundleGenerated ? "passed" : "blocked",
    required: true,
    reason: config.evidenceBundleGenerated ? undefined : "Evidence bundle is missing or malformed.",
    message: config.evidenceBundleGenerated ? "Evidence bundle was generated." : "Evidence bundle is missing or malformed.",
    category: "evidence",
  };
}

function riskGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "risk_level",
    name: "risk_level",
    label: "Risk level assigned",
    status: config.riskLevel ? "passed" : "failed",
    required: true,
    reason: config.riskLevel ? undefined : "Risk level was not assigned.",
    message: config.riskLevel ? `Risk level assigned: ${config.riskLevel}.` : "Risk level was not assigned.",
    category: "risk",
  };
}

function approvalGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "approval_required",
    name: "approval_required",
    label: "Approval required before integration",
    status: config.approvalRequired && !config.integrationAllowed ? "passed" : "blocked",
    required: true,
    reason: config.approvalRequired && !config.integrationAllowed ? undefined : "Approval policy would allow unsafe integration.",
    message: config.approvalRequired && !config.integrationAllowed
      ? "User approval is required before integration."
      : "Approval policy would allow unsafe integration.",
    category: "approval",
  };
}

function rolePolicyGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const roles = config.modelRoleRequirements;
  const serialized = JSON.stringify(roles).toLowerCase();
  const vera = roles.vera ?? {};
  const consoleRole = roles.console ?? {};
  const senior = roles.senior ?? {};
  const violations: string[] = [];
  if (serialized.includes("qwen")) violations.push("Qwen is present in role requirements.");
  if (vera.repository_write_allowed !== false) violations.push("Vera role allows repository writes.");
  if (consoleRole.fallback_allowed !== false) violations.push("Console role allows fallback.");
  if (senior.status !== "blocked_unproven") violations.push("Senior role is not blocked_unproven.");
  if (senior.fallback_allowed !== false) violations.push("Senior role allows fallback.");
  return {
    id: "role_policy",
    name: "role_policy",
    label: "Model role policy",
    status: violations.length === 0 ? "passed" : "blocked",
    required: true,
    reason: violations.length === 0 ? undefined : violations.join(" "),
    message: violations.length === 0 ? "Role policy was respected." : violations.join(" "),
    category: "role",
    details: { violations },
  };
}

function fallbackGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "no_model_fallback",
    name: "no_model_fallback",
    label: "No model fallback",
    status: config.fallbackUsed ? "blocked" : "passed",
    required: true,
    reason: config.fallbackUsed ? "A model fallback was used." : undefined,
    message: config.fallbackUsed ? "A model fallback was used." : "No model fallback was used.",
    category: "safety",
  };
}

function seniorUsageGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    id: "senior_super_not_used",
    name: "senior_super_not_used",
    label: "Senior/Super not used",
    status: config.seniorUsed ? "blocked" : "passed",
    required: true,
    reason: config.seniorUsed ? "Senior/Super was used in a phase where it is blocked." : undefined,
    message: config.seniorUsed ? "Senior/Super was used in a phase where it is blocked." : "Senior/Super was not used.",
    category: "safety",
  };
}

function prototypeWorkspaceGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const workspace = path.resolve(config.prototypeWorkspacePath);
  const expectedSegment = `${path.sep}.prototype-loop${path.sep}${config.taskId}`;
  const workspaceLooksRight = workspace.includes(expectedSegment);
  const escaped = config.filesCreatedOrChanged.filter((file) => !file.startsWith(`.prototype-loop/${config.taskId}/`));
  return {
    id: "prototype_workspace_scope",
    name: "prototype_workspace_scope",
    label: "Prototype workspace scope",
    status: workspaceLooksRight && escaped.length === 0 ? "passed" : "blocked",
    required: true,
    reason: workspaceLooksRight && escaped.length === 0 ? undefined : "Prototype files or workspace did not stay under .prototype-loop/<task-id>.",
    message: workspaceLooksRight && escaped.length === 0
      ? "Prototype files stayed under .prototype-loop/<task-id>."
      : "Prototype files or workspace did not stay under .prototype-loop/<task-id>.",
    category: "workspace",
    details: { escaped_files: escaped, workspace },
  };
}

function optionalCommandGates(config: AcceptanceThresholdConfig): AcceptanceGateResult[] {
  if (config.lintTypecheckResults.length === 0) {
    return [{
      id: "optional_lint_typecheck_build",
      name: "optional_lint_typecheck_build",
      label: "Optional lint/typecheck/build",
      status: "not_applicable",
      required: false,
      reason: "No lint/typecheck/build checks were configured for the prototype workspace.",
      message: "No lint/typecheck/build checks were configured for the prototype workspace.",
      category: "command",
    }];
  }
  return config.lintTypecheckResults.map((result) => {
    if (result.status === "skipped") {
      return {
        id: "optional_lint_typecheck_build",
        name: "optional_lint_typecheck_build",
        label: "Optional lint/typecheck/build",
        status: "not_applicable",
        required: false,
        reason: result.stderr || "Optional check was not applicable.",
        message: result.stderr || "Optional check was not applicable.",
        command: result.command,
        output_summary: result.stderr,
        category: "command",
        details: { command: result.command },
      };
    }
    return {
      id: `optional_${result.command.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      name: `optional_${result.command.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      label: `Optional check: ${result.command}`,
      status: result.status === "passed" ? "passed" : "failed",
      required: false,
      command: result.command,
      output_summary: result.stderr,
      message: result.status === "passed" ? `${result.command} passed.` : `${result.command} failed.`,
      category: "command",
      details: { command: result.command },
    };
  });
}

function gatePassed(gates: AcceptanceGateResult[], name: string): boolean {
  return gates.some((gate) => gate.name === name && gate.status === "passed");
}

function explicitGateResults(config: AcceptanceThresholdConfig): AcceptanceGateResult[] {
  return (config.gates ?? []).map((gate) => ({
    id: gate.id,
    name: gate.id,
    label: gate.label,
    status: gate.status,
    required: gate.required,
    reason: gate.reason,
    message: gate.reason ?? `${gate.label}: ${gate.status}`,
    command: gate.command,
    output_summary: gate.output_summary,
    evidence_ref: gate.evidence_ref,
    category: gate.category,
  }));
}

function explicitCommandResultGates(config: AcceptanceThresholdConfig): AcceptanceGateResult[] {
  return (config.commandResults ?? []).map((result) => {
    const id = `command_${result.command.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    const status: AcceptanceGateStatus = result.status === "blocked"
      ? "blocked"
      : result.status === "failed"
        ? "failed"
        : result.status === "skipped"
          ? "skipped"
          : "passed";
    return {
      id,
      name: id,
      label: `Command check: ${result.command}`,
      status,
      required: result.required ?? true,
      reason: result.reason,
      message: result.reason ?? `Command ${result.command} ${status}.`,
      command: result.command,
      output_summary: result.output_summary,
      category: "command",
      details: { exitCode: result.exitCode },
    };
  });
}

function skippedCheckGates(config: AcceptanceThresholdConfig): AcceptanceGateResult[] {
  return (config.skippedChecks ?? []).map((check) => ({
    id: check.id,
    name: check.id,
    label: check.label,
    status: "skipped",
    required: check.required,
    reason: check.reason,
    message: check.reason
      ? `${check.label} skipped: ${check.reason}`
      : `${check.label} skipped without a reason.`,
    command: check.command,
    category: "command",
  }));
}

function normalizeGate(gate: AcceptanceGateResult): AcceptanceThresholdGate {
  return {
    id: gate.id,
    label: gate.label,
    required: gate.required,
    status: gate.status,
    reason: gate.reason ?? gate.message,
    command: gate.command,
    output_summary: gate.output_summary,
    evidence_ref: gate.evidence_ref,
    category: gate.category,
  };
}

function commandResultsFromLegacyConfig(config: AcceptanceThresholdConfig): AcceptanceCommandResult[] {
  return [
    ...config.testResults.map((result) => ({
      command: result.command,
      status: result.status === "passed" ? "passed" as const : "failed" as const,
      exitCode: result.exitCode,
      required: config.requiredTestsConfigured,
    })),
    ...config.lintTypecheckResults.map((result) => ({
      command: result.command,
      status: result.status === "passed"
        ? "passed" as const
        : result.status === "skipped"
          ? "skipped" as const
          : "failed" as const,
      required: false,
      reason: result.stderr,
      output_summary: result.stderr,
    })),
  ];
}

function isSafetyGate(gate: AcceptanceGateResult): boolean {
  return gate.category === "safety"
    || gate.category === "approval"
    || gate.category === "role"
    || gate.category === "workspace"
    || gate.name === "scope_check"
    || gate.name === "secret_scan"
    || gate.name === "no_integration"
    || gate.name === "approval_required"
    || gate.name === "role_policy"
    || gate.name === "no_model_fallback"
    || gate.name === "senior_super_not_used"
    || gate.name === "prototype_workspace_scope";
}

function uniqueGates(gates: AcceptanceGateResult[]): AcceptanceGateResult[] {
  const seen = new Set<string>();
  return gates.filter((gate) => {
    if (seen.has(gate.name)) return false;
    seen.add(gate.name);
    return true;
  });
}
