import path from "path";

export type AcceptanceReadinessStatus = "ready_for_user_approval" | "not_ready" | "blocked";
export type AcceptanceGateStatus = "passed" | "failed" | "blocked" | "skipped" | "not_applicable";

export interface AcceptanceThresholdConfig {
  taskId: string;
  riskLevel: string | null;
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
  name: string;
  status: AcceptanceGateStatus;
  required: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface AcceptanceThresholdVerdict {
  status: AcceptanceReadinessStatus;
  ready: boolean;
  risk_level: string | null;
  required_gates: string[];
  passed_gates: string[];
  failed_gates: string[];
  skipped_gates: string[];
  blocked_gates: string[];
  warnings: string[];
  unresolved_issues: string[];
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
  ];

  const required = gates.filter((gate) => gate.required);
  const failed = required.filter((gate) => gate.status === "failed");
  const blocked = required.filter((gate) => gate.status === "blocked");
  const warnings = config.preExistingUnrelatedFailures?.map((failure) => (
    `Pre-existing unrelated failure recorded for ${failure.command}: ${failure.summary}`
  )) ?? [];
  const status: AcceptanceReadinessStatus = blocked.length > 0
    ? "blocked"
    : failed.length > 0
      ? "not_ready"
      : "ready_for_user_approval";
  const unresolved = [...blocked, ...failed].map((gate) => gate.message);

  return {
    status,
    ready: status === "ready_for_user_approval",
    risk_level: config.riskLevel,
    required_gates: required.map((gate) => gate.name),
    passed_gates: gates.filter((gate) => gate.status === "passed").map((gate) => gate.name),
    failed_gates: gates.filter((gate) => gate.status === "failed").map((gate) => gate.name),
    skipped_gates: gates.filter((gate) => gate.status === "skipped" || gate.status === "not_applicable").map((gate) => gate.name),
    blocked_gates: gates.filter((gate) => gate.status === "blocked").map((gate) => gate.name),
    warnings,
    unresolved_issues: unresolved,
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
    blocking_failures: blocked.map((gate) => gate.message),
    summary: status === "ready_for_user_approval"
      ? "All required acceptance gates passed; ready for user approval."
      : `Acceptance threshold ${status}; ${unresolved.length} required gate(s) need attention.`,
  };
}

function testGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  if (!config.requiredTestsConfigured) {
    return {
      name: "task_tests",
      status: "not_applicable",
      required: false,
      message: "No task-specific tests were configured for this run.",
    };
  }
  const latestByCommand = new Map<string, { command: string; status: string; exitCode: number }>();
  for (const result of config.testResults) {
    latestByCommand.set(result.command, result);
  }
  const latestResults = Array.from(latestByCommand.values());
  const failed = latestResults.filter((result) => result.status !== "passed" || result.exitCode !== 0);
  return {
    name: "task_tests",
    status: failed.length === 0 && latestResults.length > 0 ? "passed" : "failed",
    required: true,
    message: failed.length === 0 && latestResults.length > 0
      ? "Latest configured task-specific test results passed."
      : "Latest configured task-specific test results failed or did not run.",
    details: {
      commands: latestResults.map((result) => result.command),
      historical_result_count: config.testResults.length,
    },
  };
}

function scopeGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const unexpected = config.diffScopeCheck.unexpected_files ?? [];
  return {
    name: "scope_check",
    status: config.diffScopeCheck.status === "passed" && unexpected.length === 0 ? "passed" : "blocked",
    required: true,
    message: unexpected.length === 0 ? "Changed files stayed inside the allowed prototype scope." : "Changed files escaped the allowed prototype scope.",
    details: { unexpected_files: unexpected },
  };
}

function secretScanGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const findings = config.secretScanResult.findings ?? [];
  return {
    name: "secret_scan",
    status: config.secretScanResult.status === "passed" && findings.length === 0 ? "passed" : "blocked",
    required: true,
    message: findings.length === 0 ? "No obvious secret patterns were found." : "Secret-like patterns were found.",
    details: { findings },
  };
}

function noIntegrationGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "no_integration",
    status: config.integrationPerformed ? "blocked" : "passed",
    required: true,
    message: config.integrationPerformed ? "Integration occurred before approval." : "No integration occurred before approval.",
  };
}

function evidenceBundleGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "evidence_bundle",
    status: config.evidenceBundleGenerated ? "passed" : "blocked",
    required: true,
    message: config.evidenceBundleGenerated ? "Evidence bundle was generated." : "Evidence bundle is missing or malformed.",
  };
}

function riskGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "risk_level",
    status: config.riskLevel ? "passed" : "failed",
    required: true,
    message: config.riskLevel ? `Risk level assigned: ${config.riskLevel}.` : "Risk level was not assigned.",
  };
}

function approvalGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "approval_required",
    status: config.approvalRequired && !config.integrationAllowed ? "passed" : "blocked",
    required: true,
    message: config.approvalRequired && !config.integrationAllowed
      ? "User approval is required before integration."
      : "Approval policy would allow unsafe integration.",
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
    name: "role_policy",
    status: violations.length === 0 ? "passed" : "blocked",
    required: true,
    message: violations.length === 0 ? "Role policy was respected." : violations.join(" "),
    details: { violations },
  };
}

function fallbackGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "no_model_fallback",
    status: config.fallbackUsed ? "blocked" : "passed",
    required: true,
    message: config.fallbackUsed ? "A model fallback was used." : "No model fallback was used.",
  };
}

function seniorUsageGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  return {
    name: "senior_super_not_used",
    status: config.seniorUsed ? "blocked" : "passed",
    required: true,
    message: config.seniorUsed ? "Senior/Super was used in a phase where it is blocked." : "Senior/Super was not used.",
  };
}

function prototypeWorkspaceGate(config: AcceptanceThresholdConfig): AcceptanceGateResult {
  const workspace = path.resolve(config.prototypeWorkspacePath);
  const expectedSegment = `${path.sep}.prototype-loop${path.sep}${config.taskId}`;
  const workspaceLooksRight = workspace.includes(expectedSegment);
  const escaped = config.filesCreatedOrChanged.filter((file) => !file.startsWith(`.prototype-loop/${config.taskId}/`));
  return {
    name: "prototype_workspace_scope",
    status: workspaceLooksRight && escaped.length === 0 ? "passed" : "blocked",
    required: true,
    message: workspaceLooksRight && escaped.length === 0
      ? "Prototype files stayed under .prototype-loop/<task-id>."
      : "Prototype files or workspace did not stay under .prototype-loop/<task-id>.",
    details: { escaped_files: escaped, workspace },
  };
}

function optionalCommandGates(config: AcceptanceThresholdConfig): AcceptanceGateResult[] {
  if (config.lintTypecheckResults.length === 0) {
    return [{
      name: "optional_lint_typecheck_build",
      status: "not_applicable",
      required: false,
      message: "No lint/typecheck/build checks were configured for the prototype workspace.",
    }];
  }
  return config.lintTypecheckResults.map((result) => {
    if (result.status === "skipped") {
      return {
        name: "optional_lint_typecheck_build",
        status: "not_applicable",
        required: false,
        message: result.stderr || "Optional check was not applicable.",
        details: { command: result.command },
      };
    }
    return {
      name: `optional_${result.command.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      status: result.status === "passed" ? "passed" : "failed",
      required: false,
      message: result.status === "passed" ? `${result.command} passed.` : `${result.command} failed.`,
      details: { command: result.command },
    };
  });
}

function gatePassed(gates: AcceptanceGateResult[], name: string): boolean {
  return gates.some((gate) => gate.name === name && gate.status === "passed");
}
