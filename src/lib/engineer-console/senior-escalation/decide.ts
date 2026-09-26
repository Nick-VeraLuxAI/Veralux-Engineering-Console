import { isSeniorEscalationAutoCallAllowed } from "./auto-call-config";
import {
  SENIOR_ESCALATION_AUTO_SERVE,
  SENIOR_ESCALATION_REASONS,
  type SeniorEscalationDecision,
  type SeniorEscalationInput,
  type SeniorEscalationReason,
} from "./types";

const DOMAIN_PATTERNS: Record<
  Extract<
    SeniorEscalationReason,
    | "architecture_review"
    | "approval_gate_risk"
    | "persistent_state_risk"
    | "auth_or_security_risk"
    | "data_contract_risk"
    | "large_context_diagnosis"
  >,
  RegExp
> = {
  architecture_review:
    /\barchitect(ure|ural)?\b|\borchestrat(?:e|ion|or)\b|\bpayment(?:s)?\b|\bstripe\b/i,
  approval_gate_risk:
    /\bapproval gates?\b|\bhuman approval\b|\bsign[- ]offs?\b|\bself-authoriz(?:e|ation)\b/i,
  persistent_state_risk:
    /\bpersistent(?:\s+state)?\b|\bdatabase\b|\bschema\b|\bmigrations?\b|\bsqlite\b|\bledger\b/i,
  auth_or_security_risk:
    /\bauth(?:n|z)?\b|\bauthentication\b|\bauthorization\b|\bsecurity\b|\boauth\b|\bjwt\b|\bcsrf\b|\bsecret(?:s)?\b/i,
  data_contract_risk: /\bdata contracts?\b|\bapi contracts?\b|\bschema contracts?\b|\bopenapi\b/i,
  large_context_diagnosis: /\blarge[- ]context\b|\b>8k\b|\brepo-wide (?:diagnos|review|judgment)\b/i,
};

function uniqueReasons(reasons: SeniorEscalationReason[]): SeniorEscalationReason[] {
  const seen = new Set<SeniorEscalationReason>();
  return SENIOR_ESCALATION_REASONS.filter((reason) => {
    if (!reasons.includes(reason) || seen.has(reason)) return false;
    seen.add(reason);
    return true;
  });
}

function haystackOf(input: SeniorEscalationInput): string {
  return [
    input.objective,
    input.investigationSummary,
    input.planSummary,
    input.implementationSummary,
    input.diffSummary,
    input.seniorQuestion,
    ...(input.openRisks ?? []),
    ...(input.changedFiles ?? []),
    ...(input.qcFailures ?? []).map((failure) => failure.summary),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

export function detectSeniorDomainReasons(input: SeniorEscalationInput): SeniorEscalationReason[] {
  const reasons: SeniorEscalationReason[] = [];
  const signals = input.domainSignals ?? {};
  const haystack = haystackOf(input);

  if (signals.architecture || signals.payment || signals.orchestration) {
    reasons.push("architecture_review");
  }
  if (signals.approvalGates) reasons.push("approval_gate_risk");
  if (signals.persistentState) reasons.push("persistent_state_risk");
  if (signals.authOrSecurity) reasons.push("auth_or_security_risk");
  if (signals.dataContract) reasons.push("data_contract_risk");
  if (signals.largeContext) reasons.push("large_context_diagnosis");

  for (const [reason, pattern] of Object.entries(DOMAIN_PATTERNS) as Array<
    [keyof typeof DOMAIN_PATTERNS, RegExp]
  >) {
    if (pattern.test(haystack)) reasons.push(reason);
  }

  return uniqueReasons(reasons);
}

export function collectRepeatedFailureClasses(input: SeniorEscalationInput): string[] {
  if (input.repeatedFailureClasses?.length) {
    return [...new Set(input.repeatedFailureClasses.filter(Boolean))];
  }

  const counts = new Map<string, number>();
  const bump = (value: string | null | undefined) => {
    const key = value?.trim();
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const attempt of input.priorAttempts ?? []) {
    bump(attempt.failureClass);
  }
  for (const failure of input.qcFailures ?? []) {
    bump(failure.class ?? failure.identity);
  }
  if (input.failureClass) bump(input.failureClass);

  return [...counts.entries()].filter(([, count]) => count >= 2).map(([name]) => name);
}

function hasFailedQc(input: SeniorEscalationInput): boolean {
  if (input.qcPassed === false) return true;
  if ((input.qcFailures ?? []).length > 0) return true;
  return (input.testResults ?? []).some((result) => result.passed === false);
}

function isPrReadiness(input: SeniorEscalationInput): boolean {
  if (input.prReadiness === true || input.deliveryCandidate === true) return true;
  if (input.deliveryCandidateStatus === "ready") return true;
  return input.currentStage === "waiting_for_approval";
}

export function isRepairBudgetExhausted(input: SeniorEscalationInput): boolean {
  if (input.repairBudgetExhausted === true || input.budgetExhausted === true) return true;
  if (input.failureClass === "BUDGET_EXHAUSTED") return true;
  const used = input.repairAttempts ?? 0;
  const max = input.maxRepairAttempts;
  return typeof max === "number" && max > 0 && used >= max;
}

function summarize(
  reasons: SeniorEscalationReason[],
  shouldEscalate: boolean,
  autoCallAllowed: boolean,
): string {
  if (!shouldEscalate) {
    return "No senior escalation. Continue with the current Nano worker. DeepSeek remains on-demand and is not auto-called.";
  }
  if (autoCallAllowed) {
    return [
      `Recommend deepseek-senior review (${reasons.join(", ")}).`,
      "AE auto-call enabled when senior endpoint is served on 127.0.0.1:1919.",
      "Human approval gates remain required after any senior response.",
    ].join(" ");
  }
  return [
    `Recommend on-demand deepseek-senior review (${reasons.join(", ")}).`,
    "autoCallAllowed=false. autoServe=false.",
    "Operator must manually serve FreeToken on 127.0.0.1:1919 before any live senior call.",
  ].join(" ");
}

export function decideSeniorEscalation(
  input: SeniorEscalationInput,
  env: NodeJS.ProcessEnv = process.env,
): SeniorEscalationDecision {
  const reasons: SeniorEscalationReason[] = [];
  const repeated = collectRepeatedFailureClasses(input);

  if (hasFailedQc(input)) reasons.push("failed_qc");
  if (repeated.length > 0) reasons.push("repeated_failure_class");
  if (isRepairBudgetExhausted(input)) reasons.push("repair_loop_exhausted");
  if (isPrReadiness(input)) reasons.push("pr_readiness_review");
  reasons.push(...detectSeniorDomainReasons(input));

  const ordered = uniqueReasons(reasons);
  const shouldEscalate = ordered.length > 0;
  const autoCallAllowed = isSeniorEscalationAutoCallAllowed(env);

  return {
    shouldEscalate,
    reasons: ordered,
    recommendedProfile: "deepseek-senior",
    requiresManualServe: true,
    autoCallAllowed,
    autoServe: SENIOR_ESCALATION_AUTO_SERVE,
    humanReadableSummary: summarize(ordered, shouldEscalate, autoCallAllowed),
  };
}

export function defaultSeniorQuestion(
  input: SeniorEscalationInput,
  reasons: SeniorEscalationReason[],
): string {
  const explicit = input.seniorQuestion?.trim();
  if (explicit) return explicit;
  if (!reasons.length) return "No senior judgment requested.";
  if (reasons.includes("failed_qc") || reasons.includes("repeated_failure_class") || reasons.includes("repair_loop_exhausted")) {
    return "Diagnose the root cause of the failed or exhausted worker loop. Distinguish symptom patches from a real fix, list missing evidence, and specify the next bounded worker mission plus QC gates.";
  }
  if (reasons.includes("pr_readiness_review")) {
    return "Review this delivery candidate for PR-readiness: correctness, missing evidence, residual defects, and approval, security, or data-contract risks.";
  }
  if (reasons.includes("large_context_diagnosis")) {
    return "Diagnose from the evidence pack. Do not demand the full raw repo. Identify root cause, missing evidence, and the next worker mission.";
  }
  return "Provide senior architect judgment on architecture, contracts, authority, and the next worker mission. Do not modify files.";
}
