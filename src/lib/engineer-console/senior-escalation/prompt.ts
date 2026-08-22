import type { SeniorEscalationPackage } from "./types";

function bullet(items: string[]): string {
  if (!items.length) return "- (none provided)";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatTests(pkg: SeniorEscalationPackage): string {
  if (!pkg.testResults.length && !pkg.testCommands.length) return "- (none provided)";
  const fromResults = pkg.testResults.map(
    (result) => `- ${result.command}: ${result.passed ? "PASS" : "FAIL"}${result.summary ? ` — ${result.summary}` : ""}`,
  );
  const leftover = pkg.testCommands
    .filter((command) => !pkg.testResults.some((result) => result.command === command))
    .map((command) => `- ${command}: result not provided`);
  return [...fromResults, ...leftover].join("\n") || "- (none provided)";
}

function formatFailures(pkg: SeniorEscalationPackage): string {
  const qc = pkg.qcFailures.map((failure) => {
    const cls = failure.class ?? failure.identity ?? "unclassified";
    return `- QC ${cls}: ${failure.summary}`;
  });
  const repeated = pkg.repeatedFailureClasses.map((name) => `- Repeated failure class: ${name}`);
  const lines = [...qc, ...repeated];
  return lines.length ? lines.join("\n") : "- (none provided)";
}

function formatClarifications(pkg: SeniorEscalationPackage): string {
  if (!pkg.clarificationHistory.length) return "- (none provided)";
  return pkg.clarificationHistory
    .map((item) => `- Q: ${item.question}\n  A: ${item.answer?.trim() || "(unanswered)"}`)
    .join("\n");
}

/**
 * Deterministic senior-review prompt. Does not fetch, serve, or mutate files.
 */
export function renderSeniorEscalationPrompt(pkg: SeniorEscalationPackage): string {
  return [
    "## Role",
    "You are the senior architect / reviewer / failed-run diagnostician inside VeraLux Engineering Console.",
    "Your profile id is `deepseek-senior` (DeepSeek-V4-Flash FTW). This profile is on-demand only.",
    "You are not the live AE implementation worker. Do not modify files, run shells, approve PRs, merge, deploy, or self-authorize gates.",
    "Diagnose root cause. Distinguish symptom patching from real fixes. Identify missing evidence. Propose the next worker mission. Specify QC gates. Call out approval, security, and data-contract risks.",
    "Return a structured response only.",
    "",
    "## Objective",
    pkg.objective.trim() || "(none provided)",
    "",
    "## Current Status",
    `- Task: ${pkg.taskId ?? "(none)"}`,
    `- Run: ${pkg.runId ?? "(none)"}`,
    `- Stage: ${pkg.currentStage ?? "(none)"}`,
    `- Worker profile: ${pkg.workerProfile.id} (${pkg.workerProfile.role}) at ${pkg.workerProfile.openaiBaseUrl}`,
    `- Runtime mode: ${pkg.runtimeMode ?? "(none)"}`,
    `- Escalation recommended: ${pkg.decision.shouldEscalate ? "yes" : "no"}`,
    `- Reasons: ${pkg.decision.reasons.join(", ") || "(none)"}`,
    `- Recommended senior profile: ${pkg.decision.recommendedProfile} (on-demand, requiresManualServe=true, autoCallAllowed=false, autoServe=false)`,
    `- DeepSeek manually serving: ${pkg.seniorProfile.manuallyServing ? "yes" : "no"} — package anyway; do not auto-call`,
    "",
    "## Evidence",
    `Investigation: ${pkg.investigationSummary?.trim() || "(none provided)"}`,
    `Plan: ${pkg.planSummary?.trim() || "(none provided)"}`,
    `Implementation: ${pkg.implementationSummary?.trim() || "(none provided)"}`,
    `Diff summary: ${pkg.diffSummary?.trim() || "(none provided)"}`,
    `Known-good baseline: ${pkg.knownGoodBaselineNotes?.trim() || "(none provided)"}`,
    "Changed files:",
    bullet(pkg.changedFiles),
    "Evidence artifacts:",
    bullet(pkg.evidenceArtifacts),
    "Clarification history:",
    formatClarifications(pkg),
    "",
    "## Worker Attempts",
    `- Repair attempts: ${pkg.repairAttempts}`,
    `- Budget exhausted: ${pkg.budgetExhaustion.exhausted ? "yes" : "no"}`,
    "Tests:",
    formatTests(pkg),
    "",
    "## Failures",
    formatFailures(pkg),
    "",
    "## Risks",
    bullet(pkg.openRisks),
    "",
    "## Requested Senior Judgment",
    pkg.seniorQuestion,
    "Answer with root cause, not a worker-style patch list. If evidence is thin, say what is missing instead of guessing.",
    "",
    "## Required Output Format",
    "Return JSON only with this shape:",
    "{",
    '  "rootCause": string,',
    '  "symptomPatchVsRealFix": string,',
    '  "missingEvidence": string[],',
    '  "nextWorkerMission": string,',
    '  "recommendedWorkerProfile": "nano-fast" | "nano-faithful",',
    '  "qcGates": string[],',
    '  "risks": { "approval": string, "security": string, "dataContract": string },',
    '  "humanGatesStillRequired": true',
    "}",
    "Do not claim that a live senior call, file edit, or approval has occurred.",
  ].join("\n");
}
