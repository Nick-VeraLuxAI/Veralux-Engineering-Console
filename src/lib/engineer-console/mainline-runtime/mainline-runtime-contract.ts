import {
  resolveModelRole,
  type ModelRoleAssignment,
  type ModelRoleId,
  type ModelRoutingDecision,
} from "../model-routing/model-role-routing";

export const NANO_MAINLINE_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
export const VERA_NANO_MAINLINE_ENDPOINT = "http://127.0.0.1:8081/v1";
export const CONSOLE_NANO_MAINLINE_ENDPOINT = "http://127.0.0.1:8082/v1";

export const MAINLINE_LIFECYCLE_STATES = [
  "intent_intake",
  "console_task_requested",
  "governed_execution",
  "evidence_packaged",
  "awaiting_user_approval",
  "blocked",
  "failed",
] as const;

export type MainlineLifecycleState = (typeof MAINLINE_LIFECYCLE_STATES)[number];

export const MAINLINE_EVIDENCE_EXPECTATIONS = [
  "runtime_route_decision_recorded",
  "active_role_assignment_recorded",
  "changed_files_recorded_when_applicable",
  "commands_tests_recorded_when_applicable",
  "quality_gates_recorded",
  "fallback_status_recorded",
  "qwen_usage_recorded",
  "senior_requirement_recorded",
  "approval_required",
  "integration_not_performed_without_approval",
] as const;

export type MainlineEvidenceExpectation = (typeof MAINLINE_EVIDENCE_EXPECTATIONS)[number];

export type MainlineRuntimeStatus =
  | "usable_without_senior_runtime"
  | "blocked_mainline_contract_violation";

export interface MainlineActiveRoleContract {
  roleId: "vera_command" | "console_default_worker";
  responsibility: "intent_intake_approval_broker" | "governed_execution";
  endpoint: string | null;
  expectedEndpoint: string;
  model: string | null;
  expectedModel: string;
  provider: string | null;
  status: ModelRoleAssignment["status"];
  runtimeRequired: boolean;
  healthcheckRequired: boolean;
  repositoryWriteAllowed: boolean;
  fallbackAllowed: boolean;
  requiredForMainline: true;
}

export interface MainlineParkedRoleContract {
  roleId: "console_senior_worker" | "console_cold_senior_reviewer";
  runtimeName: "Nemotron Super senior worker" | "Mixtral cold senior reviewer";
  endpoint: string | null;
  model: string | null;
  status: ModelRoleAssignment["status"];
  requiredForMainline: false;
  runtimeRequired: false;
  healthcheckRequired: false;
  repositoryWriteAllowed: false;
  fallbackAllowed: false;
  promotionStatus: "blocked_unproven" | "parked_experimental_offline_only";
  notes: string | null;
}

export interface MainlineEvidencePolicy {
  expectations: MainlineEvidenceExpectation[];
  approvalRequired: true;
  integrationAllowedBeforeApproval: false;
  integrationPerformed: boolean;
}

export interface MainlineSafetyPolicy {
  fallbackAllowed: false;
  fallbackUsed: boolean;
  qwenUsed: boolean;
  qwenFallbackUsed: false;
  seniorRuntimeRequired: false;
  superRequiredForMainline: false;
  mixtralRequiredForMainline: false;
  approvalRequiredBeforeIntegration: true;
}

export interface MainlineRuntimeContract {
  contractSchema: "mainline_runtime.phase_20.v1";
  phase: 20;
  status: MainlineRuntimeStatus;
  statusSummary: string;
  activeRoles: MainlineActiveRoleContract[];
  parkedRoles: MainlineParkedRoleContract[];
  lifecycleStates: MainlineLifecycleState[];
  evidencePolicy: MainlineEvidencePolicy;
  safetyPolicy: MainlineSafetyPolicy;
  routingDecisions: Array<{
    roleId: ModelRoleId;
    routeStatus: string;
    selectedRoleId: ModelRoleId | null;
    selectedEndpoint: string | null;
    fallbackUsed: boolean;
    fallbackReason: string | null;
  }>;
  diagnostics: string[];
}

export interface BuildMainlineRuntimeContractInput {
  env?: NodeJS.ProcessEnv;
  routingDecisions?: ModelRoutingDecision[];
  integrationPerformed?: boolean;
}

const ACTIVE_MAINLINE_ROLE_IDS = ["vera_command", "console_default_worker"] as const;
const PARKED_ROLE_IDS = ["console_senior_worker", "console_cold_senior_reviewer"] as const;

export function buildMainlineRuntimeContract(
  input: BuildMainlineRuntimeContractInput = {},
): MainlineRuntimeContract {
  const env = input.env ?? process.env;
  const activeRoles = ACTIVE_MAINLINE_ROLE_IDS.map((roleId) => {
    const assignment = resolveModelRole(roleId, env);
    return activeRoleContract(assignment as ModelRoleAssignment & { roleId: typeof roleId }, roleId);
  });
  const parkedRoles = PARKED_ROLE_IDS.map((roleId) => {
    const assignment = resolveModelRole(roleId, env);
    return parkedRoleContract(assignment as ModelRoleAssignment & { roleId: typeof roleId }, roleId);
  });
  const routingDecisions = (input.routingDecisions ?? []).map((decision) => ({
    roleId: decision.requestedModelRoleId,
    routeStatus: decision.status,
    selectedRoleId: decision.selectedModelRoleId,
    selectedEndpoint: decision.selectedEndpoint,
    fallbackUsed: decision.fallbackUsed,
    fallbackReason: decision.fallbackReason,
  }));
  const integrationPerformed = input.integrationPerformed === true;
  const qwenUsed = containsQwen({ activeRoles, parkedRoles, routingDecisions });
  const fallbackUsed = routingDecisions.some((decision) => decision.fallbackUsed);
  const diagnostics = contractDiagnostics({
    activeRoles,
    parkedRoles,
    qwenUsed,
    fallbackUsed,
    integrationPerformed,
  });
  const usable = diagnostics.length === 0;

  return {
    contractSchema: "mainline_runtime.phase_20.v1",
    phase: 20,
    status: usable ? "usable_without_senior_runtime" : "blocked_mainline_contract_violation",
    statusSummary: usable
      ? "Nano is the active Vera and Console mainline runtime; senior runtimes are parked and not required."
      : "Mainline runtime contract has blocking diagnostics.",
    activeRoles,
    parkedRoles,
    lifecycleStates: [...MAINLINE_LIFECYCLE_STATES],
    evidencePolicy: {
      expectations: [...MAINLINE_EVIDENCE_EXPECTATIONS],
      approvalRequired: true,
      integrationAllowedBeforeApproval: false,
      integrationPerformed,
    },
    safetyPolicy: {
      fallbackAllowed: false,
      fallbackUsed,
      qwenUsed,
      qwenFallbackUsed: false,
      seniorRuntimeRequired: false,
      superRequiredForMainline: false,
      mixtralRequiredForMainline: false,
      approvalRequiredBeforeIntegration: true,
    },
    routingDecisions,
    diagnostics,
  };
}

function activeRoleContract(
  assignment: ModelRoleAssignment,
  roleId: (typeof ACTIVE_MAINLINE_ROLE_IDS)[number],
): MainlineActiveRoleContract {
  return {
    roleId,
    responsibility: roleId === "vera_command" ? "intent_intake_approval_broker" : "governed_execution",
    endpoint: assignment.endpoint,
    expectedEndpoint: roleId === "vera_command" ? VERA_NANO_MAINLINE_ENDPOINT : CONSOLE_NANO_MAINLINE_ENDPOINT,
    model: assignment.model,
    expectedModel: NANO_MAINLINE_MODEL,
    provider: assignment.provider,
    status: assignment.status,
    runtimeRequired: assignment.runtimeRequired,
    healthcheckRequired: assignment.healthcheckRequired,
    repositoryWriteAllowed: assignment.repositoryWriteAllowed,
    fallbackAllowed: assignment.fallbackAllowed,
    requiredForMainline: true,
  };
}

function parkedRoleContract(
  assignment: ModelRoleAssignment,
  roleId: (typeof PARKED_ROLE_IDS)[number],
): MainlineParkedRoleContract {
  const mixtral = roleId === "console_cold_senior_reviewer";
  return {
    roleId,
    runtimeName: mixtral ? "Mixtral cold senior reviewer" : "Nemotron Super senior worker",
    endpoint: assignment.endpoint,
    model: assignment.model,
    status: assignment.status,
    requiredForMainline: false,
    runtimeRequired: false,
    healthcheckRequired: false,
    repositoryWriteAllowed: false,
    fallbackAllowed: false,
    promotionStatus: mixtral ? "parked_experimental_offline_only" : "blocked_unproven",
    notes: assignment.notes,
  };
}

function containsQwen(value: unknown): boolean {
  return JSON.stringify(value).toLowerCase().includes("qwen");
}

function contractDiagnostics(input: {
  activeRoles: MainlineActiveRoleContract[];
  parkedRoles: MainlineParkedRoleContract[];
  qwenUsed: boolean;
  fallbackUsed: boolean;
  integrationPerformed: boolean;
}): string[] {
  const diagnostics: string[] = [];
  for (const role of input.activeRoles) {
    if (role.status !== "available") diagnostics.push(`${role.roleId}:MAINLINE_ROLE_NOT_AVAILABLE`);
    if (role.endpoint !== role.expectedEndpoint) diagnostics.push(`${role.roleId}:NANO_ENDPOINT_MISMATCH`);
    if (role.model !== role.expectedModel) diagnostics.push(`${role.roleId}:NANO_MODEL_MISMATCH`);
    if (!role.runtimeRequired) diagnostics.push(`${role.roleId}:MAINLINE_RUNTIME_REQUIRED`);
    if (!role.healthcheckRequired) diagnostics.push(`${role.roleId}:MAINLINE_HEALTHCHECK_REQUIRED`);
    if (role.fallbackAllowed) diagnostics.push(`${role.roleId}:FALLBACK_MUST_REMAIN_DISABLED`);
  }
  for (const role of input.parkedRoles) {
    if (role.requiredForMainline) diagnostics.push(`${role.roleId}:PARKED_ROLE_REQUIRED_FOR_MAINLINE`);
    if (role.runtimeRequired) diagnostics.push(`${role.roleId}:PARKED_ROLE_RUNTIME_REQUIRED`);
    if (role.healthcheckRequired) diagnostics.push(`${role.roleId}:PARKED_ROLE_HEALTHCHECK_REQUIRED`);
    if (role.repositoryWriteAllowed) diagnostics.push(`${role.roleId}:PARKED_ROLE_WRITE_ALLOWED`);
    if (role.fallbackAllowed) diagnostics.push(`${role.roleId}:PARKED_ROLE_FALLBACK_ALLOWED`);
  }
  if (input.fallbackUsed) diagnostics.push("MAINLINE_FALLBACK_USED");
  if (input.qwenUsed) diagnostics.push("MAINLINE_QWEN_USED");
  if (input.integrationPerformed) diagnostics.push("MAINLINE_INTEGRATION_REQUIRES_APPROVAL");
  return diagnostics;
}
