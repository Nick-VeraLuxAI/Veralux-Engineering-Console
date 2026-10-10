import {
  DEEPSEEK_SENIOR_PROFILE,
  getDefaultAeWorkerProfile,
  resolveAeWorkerProfile,
} from "../model-router/ae-runtime-profiles";
import {
  collectRepeatedFailureClasses,
  decideSeniorEscalation,
  defaultSeniorQuestion,
  isRepairBudgetExhausted,
} from "./decide";
import { renderSeniorEscalationPrompt } from "./prompt";
import {
  SENIOR_ESCALATION_PACKAGE_V1_ID,
  type SeniorEscalationInput,
  type SeniorEscalationPackage,
} from "./types";

function resolveWorkerProfile(input: SeniorEscalationInput) {
  const resolved = resolveAeWorkerProfile({
    profileId: input.workerProfileId ?? getDefaultAeWorkerProfile().id,
  });
  return {
    id: resolved.profile.id,
    role: resolved.profile.role,
    openaiBaseUrl: resolved.profile.openaiBaseUrl,
  };
}

/**
 * Build a storeable senior-review package. Never starts FreeToken or calls DeepSeek.
 * Still builds when DeepSeek is not serving.
 */
export function buildSeniorEscalationPackage(
  input: SeniorEscalationInput,
  env: NodeJS.ProcessEnv = process.env,
): SeniorEscalationPackage {
  const decision = decideSeniorEscalation(input, env);
  const repeatedFailureClasses = collectRepeatedFailureClasses(input);
  const repairAttempts = input.repairAttempts ?? input.priorAttempts?.filter((item) => item.outcome === "failed").length ?? 0;
  const exhausted = isRepairBudgetExhausted(input);

  const pkg: SeniorEscalationPackage = {
    id: SENIOR_ESCALATION_PACKAGE_V1_ID,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    objective: input.objective,
    currentStage: input.currentStage ?? null,
    workerProfile: resolveWorkerProfile(input),
    runtimeMode: input.runtimeMode ?? null,
    clarificationHistory: input.clarificationHistory ?? [],
    investigationSummary: input.investigationSummary ?? null,
    planSummary: input.planSummary ?? null,
    implementationSummary: input.implementationSummary ?? null,
    changedFiles: input.changedFiles ?? [],
    diffSummary: input.diffSummary ?? null,
    testCommands: input.testCommands ?? input.testResults?.map((result) => result.command) ?? [],
    testResults: input.testResults ?? [],
    qcFailures: input.qcFailures ?? [],
    repeatedFailureClasses,
    repairAttempts,
    budgetExhaustion: {
      exhausted,
      repairBudgetExhausted: exhausted,
    },
    knownGoodBaselineNotes: input.knownGoodBaselineNotes ?? null,
    evidenceArtifacts: input.evidenceArtifacts ?? [],
    openRisks: input.openRisks ?? [],
    seniorQuestion: defaultSeniorQuestion(input, decision.reasons),
    decision,
    seniorProfile: {
      id: "deepseek-senior",
      status: "on_demand",
      openaiBaseUrl: DEEPSEEK_SENIOR_PROFILE.openaiBaseUrl,
      model: DEEPSEEK_SENIOR_PROFILE.model,
      autoServe: false,
      autoCallAllowed: decision.autoCallAllowed,
      requiresManualServe: true,
      concurrentWithNano: false,
      manuallyServing: input.deepSeekManuallyServing === true,
    },
    liveInvocation: {
      attempted: false,
      networkCallMade: false,
    },
    promptText: "",
  };

  pkg.promptText = renderSeniorEscalationPrompt(pkg);
  return pkg;
}
