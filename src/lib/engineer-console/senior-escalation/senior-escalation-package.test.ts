import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { getSeniorModelCodingConfig } from "../bridge/senior-model-coding-config";
import {
  AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP,
  getDefaultAeWorkerProfile,
} from "../model-router/ae-runtime-profiles";
import {
  SENIOR_ESCALATION_AUTO_CALL_ALLOWED,
  SENIOR_ESCALATION_AUTO_SERVE,
  SENIOR_ESCALATION_PACKAGE_V1_ID,
  SENIOR_ESCALATION_REASONS,
  SENIOR_ESCALATION_WIRED_INTO_AE_LOOP,
  buildSeniorEscalationPackage,
  decideSeniorEscalation,
  renderSeniorEscalationPrompt,
} from "./index";

const smallPassingTask = {
  objective: "Add a formatDate helper that returns ISO-8601 UTC strings.",
  currentStage: "quality_checking",
  workerProfileId: "nano-fast",
  runtimeMode: "DEGRADED",
  qcPassed: true,
  testCommands: ["npx vitest run src/lib/format-date.test.ts"],
  testResults: [{ command: "npx vitest run src/lib/format-date.test.ts", passed: true, summary: "3/3" }],
  repairAttempts: 0,
} as const;

describe("senior-escalation-package-v1", () => {
  it("does not escalate a small bounded implementation with passing QC", () => {
    const decision = decideSeniorEscalation(smallPassingTask);
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.reasons).toEqual([]);
    expect(decision.recommendedProfile).toBe("deepseek-senior");
    expect(decision.autoCallAllowed).toBe(false);
    expect(decision.requiresManualServe).toBe(true);
    expect(decision.humanReadableSummary).toMatch(/No senior escalation/);
  });

  it("escalates failed QC", () => {
    const decision = decideSeniorEscalation({
      ...smallPassingTask,
      qcPassed: false,
      qcFailures: [{ class: "ENGINEERING_FAILURE", summary: "vitest failed on formatDate" }],
      testResults: [{ command: "npx vitest run src/lib/format-date.test.ts", passed: false }],
    });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reasons).toContain("failed_qc");
  });

  it("escalates when the same failure class repeats", () => {
    const decision = decideSeniorEscalation({
      objective: "Keep the helper compiling.",
      priorAttempts: [
        { iteration: 1, failureClass: "ENGINEERING_FAILURE", summary: "QC failed", outcome: "failed" },
        { iteration: 2, failureClass: "ENGINEERING_FAILURE", summary: "QC failed again", outcome: "failed" },
      ],
    });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reasons).toContain("repeated_failure_class");
  });

  it("escalates when the repair budget is exhausted", () => {
    const decision = decideSeniorEscalation({
      objective: "Repair the helper after QC failure.",
      repairAttempts: 2,
      maxRepairAttempts: 2,
      repairBudgetExhausted: true,
    });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reasons).toContain("repair_loop_exhausted");
  });

  it("escalates PR-readiness / delivery-candidate review even when QC passed", () => {
    const decision = decideSeniorEscalation({
      ...smallPassingTask,
      currentStage: "waiting_for_approval",
      deliveryCandidate: true,
      prReadiness: true,
    });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reasons).toContain("pr_readiness_review");
  });

  it("escalates architecture, data-contract, auth, and approval-gate risks", () => {
    const architecture = decideSeniorEscalation({
      objective: "Design the orchestration architecture for the payment ledger.",
      qcPassed: true,
    });
    expect(architecture.reasons).toContain("architecture_review");
    expect(architecture.reasons).toContain("persistent_state_risk");

    const contracts = decideSeniorEscalation({
      objective: "Change the OpenAPI data contract for inventory events.",
      qcPassed: true,
    });
    expect(contracts.reasons).toContain("data_contract_risk");

    const auth = decideSeniorEscalation({
      objective: "Replace session auth with JWT and tighten CSRF.",
      qcPassed: true,
      domainSignals: { authOrSecurity: true },
    });
    expect(auth.reasons).toContain("auth_or_security_risk");

    const approval = decideSeniorEscalation({
      objective: "Move protected apply behind a human approval gate and sign-off.",
      qcPassed: true,
    });
    expect(approval.reasons).toContain("approval_gate_risk");

    const large = decideSeniorEscalation({
      objective: "Need large-context diagnosis of the failed FAITHFUL run.",
      domainSignals: { largeContext: true },
    });
    expect(large.reasons).toContain("large_context_diagnosis");
  });

  it("builds a package with objective, attempts, tests, failures, diffs, evidence, risks, and senior question", () => {
    const pkg = buildSeniorEscalationPackage({
      taskId: "task-1",
      runId: "run-1",
      objective: "Fix the jobs ledger after repeated ENGINEERING_FAILURE.",
      currentStage: "diagnosing",
      workerProfileId: "nano-fast",
      runtimeMode: "DEGRADED",
      clarificationHistory: [{ question: "Which fixture?", answer: "jobs-v2" }],
      investigationSummary: "ledger.ts writes after the commit hook.",
      planSummary: "Patch persistJob and add a regression test.",
      implementationSummary: "Worker edited persistJob; QC still red.",
      changedFiles: ["src/jobs/ledger.ts", "src/jobs/ledger.test.ts"],
      diffSummary: "persistJob now awaits flush(); test expects two rows.",
      testCommands: ["npx vitest run src/jobs/ledger.test.ts"],
      testResults: [{ command: "npx vitest run src/jobs/ledger.test.ts", passed: false, summary: "expected 2 rows" }],
      qcFailures: [{ class: "ENGINEERING_FAILURE", identity: "ledger.test.ts", summary: "expected 2 rows" }],
      priorAttempts: [
        { iteration: 1, failureClass: "ENGINEERING_FAILURE", summary: "row missing", outcome: "failed" },
        { iteration: 2, failureClass: "ENGINEERING_FAILURE", summary: "row still missing", outcome: "failed" },
      ],
      repairAttempts: 2,
      knownGoodBaselineNotes: "Baseline QC had 0 owned failures.",
      evidenceArtifacts: ["evidence/ae-runs/run-1/qc.json"],
      openRisks: ["Persistent ledger may hide a transaction boundary bug."],
      deepSeekManuallyServing: false,
    });

    expect(pkg.id).toBe(SENIOR_ESCALATION_PACKAGE_V1_ID);
    expect(pkg.objective).toMatch(/jobs ledger/);
    expect(pkg.currentStage).toBe("diagnosing");
    expect(pkg.workerProfile.id).toBe("nano-fast");
    expect(pkg.repairAttempts).toBe(2);
    expect(pkg.testCommands).toContain("npx vitest run src/jobs/ledger.test.ts");
    expect(pkg.testResults[0]?.passed).toBe(false);
    expect(pkg.qcFailures[0]?.class).toBe("ENGINEERING_FAILURE");
    expect(pkg.repeatedFailureClasses).toContain("ENGINEERING_FAILURE");
    expect(pkg.diffSummary).toMatch(/persistJob/);
    expect(pkg.evidenceArtifacts[0]).toMatch(/qc\.json/);
    expect(pkg.openRisks.length).toBe(1);
    expect(pkg.seniorQuestion).toMatch(/root cause/i);
    expect(pkg.decision.shouldEscalate).toBe(true);
    expect(pkg.decision.reasons).toEqual(expect.arrayContaining([
      "failed_qc",
      "repeated_failure_class",
      "persistent_state_risk",
    ]));
    expect(pkg.liveInvocation).toEqual({ attempted: false, networkCallMade: false });
    expect(pkg.seniorProfile.manuallyServing).toBe(false);
    expect(pkg.promptText.length).toBeGreaterThan(200);
  });

  it("renders a senior prompt with role, evidence, requested judgment, and output format", () => {
    const pkg = buildSeniorEscalationPackage({
      objective: "Review auth session storage before PR.",
      currentStage: "waiting_for_approval",
      deliveryCandidate: true,
      qcPassed: true,
      changedFiles: ["src/auth/session.ts"],
      evidenceArtifacts: ["evidence/run/diff.patch"],
      seniorQuestion: "Is this PR-ready, or is the session store still a data-contract risk?",
    });
    const prompt = renderSeniorEscalationPrompt(pkg);

    expect(prompt).toContain("## Role");
    expect(prompt).toMatch(/senior architect/);
    expect(prompt).toMatch(/Do not modify files/);
    expect(prompt).toContain("## Evidence");
    expect(prompt).toContain("src/auth/session.ts");
    expect(prompt).toContain("## Requested Senior Judgment");
    expect(prompt).toContain(pkg.seniorQuestion);
    expect(prompt).toContain("## Required Output Format");
    expect(prompt).toContain("rootCause");
    expect(prompt).toContain("nextWorkerMission");
    expect(prompt).toContain("humanGatesStillRequired");
    expect(prompt).toBe(pkg.promptText);
  });

  it("references deepseek-senior as on-demand only and never makes a live network call", () => {
    const pkg = buildSeniorEscalationPackage({
      objective: "Need architecture review of the approval gate.",
      deepSeekManuallyServing: false,
    });

    expect(pkg.decision.recommendedProfile).toBe("deepseek-senior");
    expect(pkg.seniorProfile.id).toBe("deepseek-senior");
    expect(pkg.seniorProfile.status).toBe("on_demand");
    expect(pkg.seniorProfile.autoCallAllowed).toBe(false);
    expect(pkg.seniorProfile.autoServe).toBe(false);
    expect(pkg.seniorProfile.requiresManualServe).toBe(true);
    expect(pkg.seniorProfile.concurrentWithNano).toBe(false);
    expect(pkg.liveInvocation.networkCallMade).toBe(false);
    expect(SENIOR_ESCALATION_AUTO_CALL_ALLOWED).toBe(false);
    expect(SENIOR_ESCALATION_AUTO_SERVE).toBe(false);
    expect(pkg.promptText).toMatch(/on-demand only/);
    expect(SENIOR_ESCALATION_REASONS).toEqual([
      "architecture_review",
      "failed_qc",
      "repair_loop_exhausted",
      "repeated_failure_class",
      "pr_readiness_review",
      "approval_gate_risk",
      "persistent_state_risk",
      "auth_or_security_risk",
      "data_contract_risk",
      "large_context_diagnosis",
    ]);

    const sources = ["types.ts", "decide.ts", "package.ts", "prompt.ts", "index.ts"].map((file) =>
      readFileSync(path.join(__dirname, file), "utf8"),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/http\.request/);
      expect(source).not.toMatch(/\baxios\b/);
    }
  });

  it("keeps default Nano worker on FAITHFUL 8082; senior auto-call is env-gated", () => {
    expect(getDefaultAeWorkerProfile().id).toBe("nano-faithful");
    expect(getDefaultAeWorkerProfile().openaiBaseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(getLocalModelCodingConfig({}).baseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(getSeniorModelCodingConfig({}).enabled).toBe(false);
    expect(AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP).toBe(false);
    expect(SENIOR_ESCALATION_WIRED_INTO_AE_LOOP).toBe(false);

    const loopSource = readFileSync(path.join(__dirname, "..", "autonomous-engineer", "loop.ts"), "utf8");
    expect(loopSource).toMatch(/maybeAutoInvokeSeniorAfterQcFailure/);
    for (const file of ["worker-client.ts", "worker-route.ts"]) {
      expect(readFileSync(path.join(__dirname, "..", "autonomous-engineer", file), "utf8")).not.toMatch(
        /senior-escalation/,
      );
    }
  });
});
