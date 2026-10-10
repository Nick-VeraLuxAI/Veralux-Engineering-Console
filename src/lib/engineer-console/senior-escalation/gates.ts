import { normalizeLocalModelCodingBaseUrl } from "../bridge/local-model-coding-config";
import { getSeniorModelCodingConfig } from "../bridge/senior-model-coding-config";
import { isSeniorEscalationAutoCallAllowed } from "./auto-call-config";
import { DEEPSEEK_SENIOR_PROFILE } from "../model-router/ae-runtime-profiles";
import {
  REQUIRED_SENIOR_MODEL_NAME,
  REQUIRED_SENIOR_PROFILE_ID,
  type SeniorInvocationBlockedReason,
  type SeniorInvocationGate,
  type SeniorInvocationGateDecision,
  type SeniorInvocationRequest,
} from "./invoke-types";

const NANO_WORKER_PORTS = new Set(["8081", "8082"]);

export function isLocalhostBaseUrl(value: string): boolean {
  try {
    const url = new URL(normalizeLocalModelCodingBaseUrl(value));
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export function isNanoWorkerBaseUrl(value: string): boolean {
  try {
    const url = new URL(normalizeLocalModelCodingBaseUrl(value));
    return NANO_WORKER_PORTS.has(url.port);
  } catch {
    return false;
  }
}

function gate(id: string, passed: boolean, detail: string): SeniorInvocationGate {
  return { id, passed, detail };
}

function push(
  reasons: SeniorInvocationBlockedReason[],
  gates: SeniorInvocationGate[],
  id: SeniorInvocationBlockedReason,
  passed: boolean,
  detail: string,
): void {
  gates.push(gate(id, passed, detail));
  if (!passed) reasons.push(id);
}

export function checkSeniorInvocationGates(
  input: SeniorInvocationRequest = {},
): SeniorInvocationGateDecision {
  const reasons: SeniorInvocationBlockedReason[] = [];
  const gates: SeniorInvocationGate[] = [];
  const env = input.env ?? {};
  const autoInvocation = input.autoInvocation === true && isSeniorEscalationAutoCallAllowed(env);
  const pkg = input.package ?? null;
  const config = getSeniorModelCodingConfig(env);
  const explicitUrl = env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL?.trim() || "";
  const explicitModel = env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL?.trim() || "";
  const baseUrl = explicitUrl ? normalizeLocalModelCodingBaseUrl(explicitUrl) : null;
  const model = explicitModel || null;
  const approval = input.operatorApproval ?? null;
  const approvalOk = Boolean(
    approval
    && approval.approved === true
    && approval.invocationRequested === true
    && approval.approvedBy.trim().length > 0
    && (approval.packageTaskId == null || approval.packageTaskId === (pkg?.taskId ?? approval.packageTaskId))
    && (approval.packageRunId == null || approval.packageRunId === (pkg?.runId ?? approval.packageRunId)),
  );

  push(reasons, gates, "package_missing", Boolean(pkg), pkg ? "Senior escalation package is present." : "Senior escalation package is required.");

  if (pkg) {
    push(
      reasons,
      gates,
      "escalation_not_recommended",
      pkg.decision.shouldEscalate === true,
      pkg.decision.shouldEscalate ? "Package recommends escalation." : "Package does not recommend escalation.",
    );
    push(
      reasons,
      gates,
      "profile_not_deepseek_senior",
      pkg.decision.recommendedProfile === REQUIRED_SENIOR_PROFILE_ID && pkg.seniorProfile.id === REQUIRED_SENIOR_PROFILE_ID,
      `Recommended profile must be ${REQUIRED_SENIOR_PROFILE_ID}.`,
    );
    push(
      reasons,
      gates,
      "requires_manual_serve_violated",
      pkg.seniorProfile.requiresManualServe === true && DEEPSEEK_SENIOR_PROFILE.requiresManualServe === true,
      "deepseek-senior must require a manual FreeToken serve.",
    );
    push(
      reasons,
      gates,
      "auto_serve_not_false",
      pkg.seniorProfile.autoServe === false && DEEPSEEK_SENIOR_PROFILE.autoServe === false,
      "deepseek-senior autoServe must be false.",
    );
    push(
      reasons,
      gates,
      "concurrent_with_nano_not_false",
      pkg.seniorProfile.concurrentWithNano === false && DEEPSEEK_SENIOR_PROFILE.concurrentWithNano === false,
      "deepseek-senior must not be concurrent with Nano.",
    );
    const manualOnlyPackage =
      pkg.decision.autoCallAllowed === false && pkg.seniorProfile.autoCallAllowed === false;
    push(
      reasons,
      gates,
      "auto_call_not_manual",
      autoInvocation || manualOnlyPackage || approvalOk,
      autoInvocation
        ? "AE loop auto-invocation with ENGINEER_CONSOLE_SENIOR_ESCALATION_AUTO_CALL=true."
        : manualOnlyPackage
          ? "V2 treats autoCallAllowed=false as operator/manual invocation only."
          : "Operator-requested invocation with auto-call enabled in env.",
    );
    push(
      reasons,
      gates,
      "package_already_invoked",
      pkg.liveInvocation.networkCallMade === false,
      "Package must not already record a live senior chat call.",
    );
  }

  push(
    reasons,
    gates,
    "operator_approval_missing",
    autoInvocation || approvalOk,
    autoInvocation
      ? "AE loop auto-invocation bypasses manual operator confirmation."
      : approvalOk
        ? `Operator ${approval!.approvedBy} requested this senior invocation.`
        : "Operator must explicitly approve and request this senior invocation.",
  );

  push(
    reasons,
    gates,
    "senior_config_disabled",
    config.enabled === true,
    config.enabled ? "Senior model config is enabled." : "ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED must be true.",
  );
  push(
    reasons,
    gates,
    "senior_base_url_not_explicit",
    Boolean(explicitUrl),
    explicitUrl ? "Senior base URL is explicitly configured." : "ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL must be set.",
  );
  push(
    reasons,
    gates,
    "senior_model_not_explicit",
    Boolean(explicitModel),
    explicitModel ? "Senior model name is explicitly configured." : "ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL must be set.",
  );

  if (explicitUrl) {
    push(
      reasons,
      gates,
      "senior_url_not_localhost",
      isLocalhostBaseUrl(explicitUrl),
      "Senior endpoint must be localhost only.",
    );
    push(
      reasons,
      gates,
      "senior_url_is_nano_worker",
      !isNanoWorkerBaseUrl(explicitUrl),
      "Senior endpoint must not be Nano 8081 or 8082.",
    );
  }

  if (explicitModel) {
    push(
      reasons,
      gates,
      "senior_model_mismatch",
      explicitModel === REQUIRED_SENIOR_MODEL_NAME,
      `Senior model must be ${REQUIRED_SENIOR_MODEL_NAME}.`,
    );
  }

  gates.push(gate("human_gates_remain", true, "Human approval gates remain required after any senior response."));

  return {
    allowed: reasons.length === 0,
    reasons,
    gates,
    baseUrl,
    model,
    seniorEnabled: config.enabled,
  };
}
