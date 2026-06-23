import { describe, expect, it } from "vitest";
import {
  buildMainlineTaskRunProof,
  PHASE_21_EVIDENCE_PATH,
  PHASE_21_SUCCESS_LIFECYCLE,
  PHASE_21_VERDICT,
} from "./mainline-task-run-proof";
import {
  CONSOLE_NANO_MAINLINE_ENDPOINT,
  MAINLINE_EVIDENCE_EXPECTATIONS,
  NANO_MAINLINE_MODEL,
  VERA_NANO_MAINLINE_ENDPOINT,
} from "./mainline-runtime-contract";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("Phase 21 Nano mainline task run proof", () => {
  it("uses the Phase 20 Nano mainline runtime contract", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.runtimeContract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(proof.runtimeContract.status).toBe("usable_without_senior_runtime");
    expect(proof.routeDecisions).toEqual([
      {
        roleId: "vera_command",
        routeStatus: "selected_primary",
        selectedEndpoint: VERA_NANO_MAINLINE_ENDPOINT,
        selectedModel: NANO_MAINLINE_MODEL,
        fallbackUsed: false,
        source: "phase_20_mainline_runtime_contract",
      },
      {
        roleId: "console_default_worker",
        routeStatus: "selected_primary",
        selectedEndpoint: CONSOLE_NANO_MAINLINE_ENDPOINT,
        selectedModel: NANO_MAINLINE_MODEL,
        fallbackUsed: false,
        source: "phase_20_mainline_runtime_contract",
      },
    ]);
  });

  it("records lifecycle states in the expected success order", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.lifecycle.map((step) => step.state)).toEqual(PHASE_21_SUCCESS_LIFECYCLE);
    expect(proof.lifecycle.map((step) => step.state)).toEqual([
      "intent_intake",
      "console_task_requested",
      "governed_execution",
      "evidence_packaged",
      "awaiting_user_approval",
    ]);
    expect(proof.lifecycle.every((step) => step.status === "completed")).toBe(true);
  });

  it("ends at awaiting user approval", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.verdict).toBe(PHASE_21_VERDICT);
    expect(proof.finalState).toBe("awaiting_user_approval");
    expect(proof.evidencePackage.evidencePath).toBe(PHASE_21_EVIDENCE_PATH);
  });

  it("includes explicit evidence expectations", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.evidencePackage.expectations).toEqual([...MAINLINE_EVIDENCE_EXPECTATIONS]);
    expect(proof.governedTaskPlan.requiredEvidence).toEqual(expect.arrayContaining([
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
    ]));
    expect(proof.evidencePackage.explicitAndAuditable).toBe(true);
  });

  it("does not use fallback or Qwen", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.runtimeContract.safetyPolicy.fallbackAllowed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.fallbackUsed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.qwenUsed).toBe(false);
    expect(proof.safetyInvariants.fallbackDisabled).toBe(true);
    expect(proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(proof.safetyInvariants.qwenUsed).toBe(false);
    expect(proof.routeDecisions.every((decision) => decision.fallbackUsed === false)).toBe(true);
  });

  it("does not require Super or Mixtral and keeps senior routing unpromoted", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });
    const senior = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_senior_worker");
    const mixtral = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_cold_senior_reviewer");

    expect(senior).toMatchObject({
      status: "blocked_unproven",
      requiredForMainline: false,
      runtimeRequired: false,
      promotionStatus: "blocked_unproven",
    });
    expect(mixtral).toMatchObject({
      requiredForMainline: false,
      runtimeRequired: false,
      promotionStatus: "parked_experimental_offline_only",
    });
    expect(proof.safetyInvariants.superRequired).toBe(false);
    expect(proof.safetyInvariants.mixtralRequired).toBe(false);
    expect(proof.safetyInvariants.seniorRoutingPromoted).toBe(false);
  });

  it("requires approval and performs no integration", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.runtimeContract.evidencePolicy.approvalRequired).toBe(true);
    expect(proof.runtimeContract.evidencePolicy.integrationAllowedBeforeApproval).toBe(false);
    expect(proof.runtimeContract.evidencePolicy.integrationPerformed).toBe(false);
    expect(proof.safetyInvariants.approvalRequired).toBe(true);
    expect(proof.safetyInvariants.integrationPerformed).toBe(false);
    expect(proof.execution.qualityGates.find((gate) => gate.name === "approval_required")?.status).toBe("passed");
  });

  it("records no production file changes", () => {
    const proof = buildMainlineTaskRunProof({ env: EMPTY_ENV });

    expect(proof.execution.step).toBe("evidence_only_artifact_packaged");
    expect(proof.execution.productionFilesChanged).toBe(false);
    expect(proof.execution.changedFiles).toEqual([PHASE_21_EVIDENCE_PATH]);
    expect(proof.safetyInvariants.productionFilesChanged).toBe(false);
    expect(proof.governedTaskPlan.forbiddenActions).toEqual(expect.arrayContaining([
      "modify production application behavior",
      "perform integration before approval",
    ]));
  });

  it("is deterministic for the same input", () => {
    const input = {
      env: EMPTY_ENV,
      request: "Phase 21 deterministic request",
      taskId: "deterministic-phase-21-proof",
    };

    expect(buildMainlineTaskRunProof(input)).toEqual(buildMainlineTaskRunProof(input));
  });
});
