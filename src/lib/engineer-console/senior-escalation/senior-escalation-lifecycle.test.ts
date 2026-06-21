import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRoleAssignment } from "../model-routing/model-role-routing";
import type { AcceptanceThresholdVerdict } from "../prototype-loop/acceptance-threshold";
import type { PrototypeRevisionLoopResult } from "../prototype-loop/prototype-revision-loop";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import {
  createSeniorEscalationPackage,
  runSeniorEscalationDryRun,
  runSeniorEscalationLifecycle,
  shouldRequestSeniorReview,
  type SeniorEscalationContext,
} from "./senior-escalation-lifecycle";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 7 senior escalation dry-run lifecycle", () => {
  it("does not request senior review for a simple safe prototype task", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const result = await runSeniorEscalationLifecycle(simpleContext(), {
      evidenceRoot,
      now: fixedNow,
      runtimePreflight: runtimePreflightSequence(),
    });

    expect(result.status).toBe("not_required");
    expect(result.senior_review_required).toBe(false);
    expect(result.escalation_reasons).toEqual([]);
    expect(result.senior_package).toBeNull();
    expect(result.senior_result.package_path).toBeNull();
    expect(result.fallback_used).toBe(false);
    expect(result.airllm_super_used).toBe(false);
    expect(result.qwen_used).toBe(false);
    expect(result.integration_performed).toBe(false);
    expect(result.preflight_runtime_status).toBe("healthy");
    expect(result.postflight_runtime_status).toBe("healthy");
  });

  it("requests senior review for high-risk architecture/security work", () => {
    const decision = shouldRequestSeniorReview({
      ...simpleContext(),
      riskClassification: "architecture security",
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("architecture_risk");
    expect(decision.reasons).toContain("security_risk");
  });

  it("requests senior review when the acceptance threshold is blocked", () => {
    const decision = shouldRequestSeniorReview({
      ...simpleContext(),
      acceptanceThreshold: threshold("blocked"),
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("threshold_blocked");
  });

  it("requests senior review when max revision rounds are reached", () => {
    const decision = shouldRequestSeniorReview({
      ...simpleContext(),
      revisionLoop: revisionLoop("max_rounds_reached"),
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("max_revision_rounds_reached");
  });

  it("requests senior review when the user explicitly asks", () => {
    const decision = shouldRequestSeniorReview({
      ...simpleContext(),
      userRequestedSeniorReview: true,
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toEqual(["user_requested_senior_review"]);
  });

  it("requests senior review for complexity and sensitive change tags without escalating every task", () => {
    const decision = shouldRequestSeniorReview({
      ...simpleContext(),
      complexityScore: 9,
      changeTags: ["runtime_sensitive_change", "integration_sensitive_change", "large_refactor"],
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toEqual([
      "large_refactor",
      "complexity_above_threshold",
      "runtime_sensitive_change",
      "integration_sensitive_change",
    ]);
  });

  it("generates a required senior package and dry-run blocked result for the blocked senior role", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const context: SeniorEscalationContext = {
      ...simpleContext(),
      userRequestedSeniorReview: true,
      riskClassification: "architecture",
      acceptanceThreshold: threshold("blocked"),
      revisionLoop: revisionLoop("max_rounds_reached"),
      runtimeSupervisor: runtimeReport("healthy", "runtime-pre.json"),
      evidencePaths: ["evidence/prototype-loop-v1/example.json"],
      filesChanged: [".prototype-loop/task-a/word-count-cli.mjs"],
      commandsRun: ["node --test word-count-cli.test.mjs"],
    };
    const result = await runSeniorEscalationLifecycle(context, {
      evidenceRoot,
      now: fixedNow,
      runtimePreflight: runtimePreflightSequence(),
    });

    expect(result.status).toBe("dry_run_blocked");
    expect(result.senior_review_required).toBe(true);
    expect(result.senior_result.senior_role_id).toBe("console_senior_worker");
    expect(result.senior_result.senior_role_status).toBe("blocked_unproven");
    expect(result.senior_result.senior_provider).toBe("airllm-cold");
    expect(result.senior_result.senior_expected_model).toBe("Nemotron-Super-120B-A12B-FP8");
    expect(result.senior_result.blocked_reason).toBe("PHASE_7_SENIOR_ROLE_BLOCKED_UNPROVEN_DRY_RUN_ONLY");
    expect(result.senior_result.airllm_super_started).toBe(false);
    expect(result.senior_result.qwen_used).toBe(false);
    expect(result.senior_result.fallback_used).toBe(false);
    expect(result.senior_result.integration_performed).toBe(false);
    expect(result.senior_result.senior_model_inference_performed).toBe(false);
    expect(result.senior_package?.proposed_senior_review_prompt).toContain("Dry-run senior review package only");
    expect(result.senior_package?.acceptance_threshold_summary).toMatchObject({
      status: "blocked",
      ready: false,
    });
    expect(result.senior_package?.revision_loop_summary).toMatchObject({
      status: "max_rounds_reached",
      round_count: 3,
    });
    expect(result.senior_package?.runtime_supervisor_summary).toMatchObject({
      status: "healthy",
    });

    const packageJson = JSON.parse(await readFile(result.senior_result.package_path ?? "", "utf8"));
    expect(packageJson.senior_execution_mode).toBe("dry_run_blocked");
    expect(packageJson.safety.airllm_super_used).toBe(false);
    const evidenceJson = JSON.parse(await readFile(result.evidence_path, "utf8"));
    expect(evidenceJson.status).toBe("dry_run_blocked");
  });

  it("fails closed when the configured senior role is unknown", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const result = await runSeniorEscalationLifecycle({
      ...simpleContext(),
      userRequestedSeniorReview: true,
    }, {
      evidenceRoot,
      now: fixedNow,
      runtimePreflight: runtimePreflightSequence(),
      policy: {
        seniorRoleId: "unknown_senior_worker",
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.senior_result.senior_role_id).toBe("unknown_senior_worker");
    expect(result.senior_result.senior_role_status).toBe("blocked_unknown_role");
    expect(result.senior_result.blocked_reason).toBe("PHASE_7_SENIOR_ROLE_UNKNOWN_FAIL_CLOSED");
    expect(result.senior_result.airllm_super_started).toBe(false);
  });

  it("fails closed when senior role metadata is incomplete", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const seniorRole: ModelRoleAssignment = {
      ...blockedSeniorRole(),
      provider: null,
      model: null,
    };
    const dryRun = await runSeniorEscalationDryRun({
      context: { ...simpleContext(), userRequestedSeniorReview: true },
      reasons: ["user_requested_senior_review"],
      seniorRole,
      timestamp: fixedNow().toISOString(),
      packagePath: path.join(evidenceRoot, "package.json"),
      evidencePath: path.join(evidenceRoot, "evidence.json"),
    });

    expect(dryRun.result.status).toBe("dry_run_blocked");
    expect(dryRun.result.blocked_reason).toBe("PHASE_7_SENIOR_ROLE_INCOMPLETE_FAIL_CLOSED");
    expect(dryRun.result.airllm_super_started).toBe(false);
  });

  it("creates packages with required evidence context and safety statements", () => {
    const pkg = createSeniorEscalationPackage({
      context: {
        ...simpleContext(),
        acceptanceThreshold: threshold("blocked"),
        evidencePaths: ["evidence/runtime-supervisor/runtime.json"],
        filesChanged: [".prototype-loop/task-a/file.mjs"],
        commandsRun: ["node --test file.test.mjs"],
        blockingFailures: ["role_policy blocked"],
      },
      reasons: ["threshold_blocked"],
      seniorRole: blockedSeniorRole(),
      timestamp: fixedNow().toISOString(),
    });

    expect(pkg.escalation_id).toContain("senior-escalation-task-a");
    expect(pkg.relevant_evidence_paths).toEqual(["evidence/runtime-supervisor/runtime.json"]);
    expect(pkg.files_changed).toEqual([".prototype-loop/task-a/file.mjs"]);
    expect(pkg.commands_run).toEqual(["node --test file.test.mjs"]);
    expect(pkg.blocking_failures).toEqual(["role_policy blocked"]);
    expect(pkg.proposed_senior_review_prompt).toContain("Review acceptance threshold");
    expect(pkg.safety.fallback_used).toBe(false);
    expect(pkg.safety.airllm_super_used).toBe(false);
    expect(pkg.safety.qwen_used).toBe(false);
    expect(pkg.safety.integration_performed).toBe(false);
  });
});

function simpleContext(): SeniorEscalationContext {
  return {
    taskId: "task-a",
    originalRequest: "Build a tiny isolated word count CLI prototype.",
    structuredSpec: {
      task_type: "build_prototype",
      objective: "Build a tiny isolated CLI.",
    },
    riskClassification: "low",
    acceptanceCriteria: ["Tests pass", "No integration"],
    complexityScore: 2,
    changeTags: [],
    evidencePaths: [],
    filesChanged: [],
    commandsRun: [],
    blockingFailures: [],
  };
}

function threshold(status: AcceptanceThresholdVerdict["status"]): AcceptanceThresholdVerdict {
  return {
    status,
    ready: status === "ready_for_user_approval",
    risk_level: "low",
    required_gates: ["task_tests"],
    passed_gates: status === "ready_for_user_approval" ? ["task_tests"] : [],
    failed_gates: status === "not_ready" ? ["task_tests"] : [],
    skipped_gates: [],
    blocked_gates: status === "blocked" ? ["role_policy"] : [],
    warnings: [],
    unresolved_issues: status === "ready_for_user_approval" ? [] : ["A gate needs attention."],
    approval_required: true,
    integration_allowed: false,
    integration_performed: false,
    role_policy_ok: status !== "blocked",
    scope_ok: true,
    secret_scan_ok: true,
    evidence_bundle_ok: true,
    gate_results: [],
    not_applicable_gates: [],
    pre_existing_unrelated_failures: [],
    blocking_failures: status === "blocked" ? ["role_policy blocked"] : [],
    summary: `Threshold ${status}`,
  };
}

function revisionLoop(status: PrototypeRevisionLoopResult["status"]): PrototypeRevisionLoopResult {
  return {
    revision_loop_id: "loop-a",
    task_id: "task-a",
    status,
    ready_for_user_approval: status === "ready_for_user_approval",
    round_count: status === "max_rounds_reached" ? 3 : 1,
    rounds: [],
    final_readiness_verdict: status === "ready_for_user_approval" ? "ready_for_user_approval" : "not_ready",
    final_evidence_path: "evidence/prototype-loop-v1/final.json",
    final_approval_question: null,
    approval_required: true,
    integration_performed: false,
    fallback_used: false,
    senior_super_used: false,
    blocking_failures: status === "max_rounds_reached" ? ["max rounds reached"] : [],
    max_rounds: 3,
    summary: `Revision loop ${status}`,
    result_path: "evidence/prototype-loop-v1/result.json",
  };
}

function blockedSeniorRole(): ModelRoleAssignment {
  return {
    roleId: "console_senior_worker",
    roleKind: "senior_worker",
    provider: "airllm-cold",
    endpoint: "airllm:///mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
    model: "Nemotron-Super-120B-A12B-FP8",
    status: "blocked_unproven",
    repositoryWriteAllowed: false,
    fallbackAllowed: false,
    allowedFallbackRoles: [],
    runtimeRequired: false,
    healthcheckRequired: false,
    notes: "Senior role is intentionally blocked.",
  };
}

function runtimeReport(status: RuntimeSupervisorReport["status"], evidencePath: string): RuntimeSupervisorReport {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: fixedNow().toISOString(),
    status,
    check_only: true,
    recovery_enabled: false,
    roles_checked: ["vera_command", "console_default_worker", "console_senior_worker"],
    required_roles: ["vera_command", "console_default_worker"],
    role_assignments: [],
    role_health: [
      {
        role_id: "vera_command",
        endpoint: "http://127.0.0.1:8081/v1",
        expected_model: "Nemotron-Nano-30B-A3B-NVFP4",
        status: "healthy",
        models_endpoint_ok: true,
        expected_model_present: true,
        smoke_check_ok: true,
        smoke_check: {
          status: "passed",
          expected_content: "Vera route ready",
          actual_content: "Vera route ready",
          error: null,
        },
        latency_ms: 1,
        runtime_required: true,
        recovery_supported: true,
        recovery_attempted: false,
        recovery_result: null,
        model_names_returned: ["Nemotron-Nano-30B-A3B-NVFP4"],
        diagnostics: [],
        evidence_path: evidencePath,
      },
      {
        role_id: "console_default_worker",
        endpoint: "http://127.0.0.1:8082/v1",
        expected_model: "Nemotron-Nano-30B-A3B-NVFP4",
        status: "healthy",
        models_endpoint_ok: true,
        expected_model_present: true,
        smoke_check_ok: true,
        smoke_check: {
          status: "passed",
          expected_content: "Console route ready",
          actual_content: "Console route ready",
          error: null,
        },
        latency_ms: 1,
        runtime_required: true,
        recovery_supported: true,
        recovery_attempted: false,
        recovery_result: null,
        model_names_returned: ["Nemotron-Nano-30B-A3B-NVFP4"],
        diagnostics: [],
        evidence_path: evidencePath,
      },
    ],
    recovery_plans: [],
    blocked_reasons: [],
    safety_notes: ["mock runtime report"],
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
    evidence_path: evidencePath,
  };
}

function runtimePreflightSequence(): () => Promise<RuntimeSupervisorReport> {
  let count = 0;
  return async () => {
    count += 1;
    return runtimeReport("healthy", `runtime-${count}.json`);
  };
}

function fixedNow(): Date {
  return new Date("2026-06-21T20:30:00.000Z");
}

async function tempEvidenceRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "senior-escalation-"));
  tempDirs.push(dir);
  return dir;
}
