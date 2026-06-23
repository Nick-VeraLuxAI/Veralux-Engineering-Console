import fs from "fs/promises";
import path from "path";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";
import {
  runPrototypeLoopV1,
  type PrototypeLoopConsoleAssignment,
  type PrototypeLoopEvidence,
} from "./prototype-loop-v1";

export const PHASE_29A_DEFAULT_REQUEST =
  "Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.";

export const PHASE_29A_APPROVAL_QUESTION =
  "Do you want to approve implementation, request a revision, or discard this prototype?";

export interface Phase29ABuildSpec {
  task_type: "build_prototype";
  title: string;
  user_intent: string;
  target_proof_task: string;
  allowed_change_scope: string[];
  disallowed_changes: string[];
  acceptance_criteria: string[];
  required_checks: string[];
  approval_policy: {
    approval_required: true;
    implementation_allowed_without_approval: false;
    final_options: ["approve implementation", "request revision", "discard"];
  };
  evidence_requirements: string[];
}

export interface Phase29APrototypeLoopResult {
  phase: "29A";
  status: "ready_for_user_approval" | "passed_with_skips" | "blocked" | "failed" | "requires_revision";
  structured_build_spec: Phase29ABuildSpec;
  console_tracking: {
    task_id: string;
    run_id: string;
    task_status: string;
    run_status: string;
  };
  evidence_path: string;
  workspace_path: string;
  evidence: PrototypeLoopEvidence & Phase29AEvidenceAddendum;
  vera_summary: Phase29AVeraSummary;
  approval_options: Phase29ABuildSpec["approval_policy"]["final_options"];
}

export interface Phase29AVeraSummary {
  what_was_built: string;
  where_it_was_built: string;
  what_passed: string[];
  what_failed_or_was_skipped: string[];
  risks_or_limitations: string[];
  approval_question: typeof PHASE_29A_APPROVAL_QUESTION;
}

interface Phase29AEvidenceAddendum {
  phase: "29A";
  structured_build_spec: Phase29ABuildSpec;
  console_tracking: Phase29APrototypeLoopResult["console_tracking"];
  acceptance_criteria_status: Array<{
    criterion: string;
    status: "passed" | "failed";
    evidence: string;
  }>;
  risks_limitations: string[];
  readiness_status: PrototypeLoopEvidence["status"];
  threshold_engine_input: PrototypeLoopEvidence["threshold_engine_input"];
  threshold_engine_gates: PrototypeLoopEvidence["threshold_engine_gates"];
  threshold_engine_output: PrototypeLoopEvidence["threshold_engine_output"];
  vera_summary: Phase29AVeraSummary;
  approval_options: Phase29ABuildSpec["approval_policy"]["final_options"];
}

export interface RunPhase29APrototypeLoopOptions {
  request?: string;
  repoRoot?: string;
  workspaceRoot?: string;
  evidenceRoot?: string;
  now?: Date;
}

export async function runPhase29APrototypeLoop(
  options: RunPhase29APrototypeLoopOptions = {},
): Promise<Phase29APrototypeLoopResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const spec = createPhase29ABuildSpec(options.request);
  validatePhase29ABuildSpec(spec);

  const task = createTask({
    title: spec.title,
    description: JSON.stringify(spec, null, 2),
    targetRepoPath: repoRoot,
    priority: "normal",
    status: "queued",
  });
  const run = createRun(task.id, "prototype_loop_v1_console_build");
  updateRun(run.id, {
    status: "generating_patch",
    currentStep: "prototype_loop_v1_build",
    startedAt: (options.now ?? new Date()).toISOString(),
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      phase: "29A",
      approvalRequired: true,
      integrationAllowed: false,
      disallowedChanges: spec.disallowed_changes,
    }),
  });

  const assignment = buildPhase29AConsoleAssignment(spec, task.id);
  const evidence = await runPrototypeLoopV1(assignment, {
    repoRoot,
    workspaceRoot: options.workspaceRoot,
    evidenceRoot: options.evidenceRoot,
    now: options.now,
  });

  saveQualityGateResults(run.id, [
    ...evidence.test_results,
    ...evidence.lint_typecheck_results,
  ]);

  const approvalAllowed = evidence.acceptance_threshold.approval_allowed;
  const taskStatus = approvalAllowed ? "waiting_for_approval" : "failed";
  const runStatus = approvalAllowed ? "waiting_for_approval" : "failed";
  updateTask(task.id, { status: taskStatus });
  updateRun(run.id, {
    status: runStatus,
    currentStep: "awaiting_user_approval",
    completedAt: (options.now ?? new Date()).toISOString(),
    agentMessage: evidence.what_was_created,
  });

  const consoleTracking = {
    task_id: task.id,
    run_id: run.id,
    task_status: taskStatus,
    run_status: runStatus,
  };
  const veraSummary = buildPhase29AVeraSummary(evidence);
  const enrichedEvidence = await writePhase29AEvidenceAddendum(evidence, {
    spec,
    consoleTracking,
    veraSummary,
  });

  saveApprovalReport(run.id, JSON.stringify({
    taskSummary: spec.user_intent,
    branchName: null,
    changedFiles: enrichedEvidence.files_created_or_changed,
    riskLevel: "low",
    governanceIssues: enrichedEvidence.risks_limitations,
    qualityGateResults: [],
    diffSummary: enrichedEvidence.patch_diff_summary,
    recommendedNextAction: PHASE_29A_APPROVAL_QUESTION,
    canApprove: enrichedEvidence.acceptance_threshold.approval_allowed,
  }));

  return {
    phase: "29A",
    status: enrichedEvidence.status,
    structured_build_spec: spec,
    console_tracking: consoleTracking,
    evidence_path: enrichedEvidence.evidence_path,
    workspace_path: enrichedEvidence.workspace_path,
    evidence: enrichedEvidence,
    vera_summary: veraSummary,
    approval_options: spec.approval_policy.final_options,
  };
}

export function createPhase29ABuildSpec(request = PHASE_29A_DEFAULT_REQUEST): Phase29ABuildSpec {
  const userIntent = request.trim() || PHASE_29A_DEFAULT_REQUEST;
  return {
    task_type: "build_prototype",
    title: "Tiny Word Count CLI Prototype",
    user_intent: userIntent,
    target_proof_task:
      "Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.",
    allowed_change_scope: [".prototype-loop/<task-id>/", "evidence/prototype-loop-v1/<task-id>.json"],
    disallowed_changes: [
      "production source integration",
      "git commits, pushes, merges, or pull requests",
      "model fallback, Qwen routing, Super escalation, or AirLLM startup",
      "writes outside the isolated prototype workspace and evidence bundle",
    ],
    acceptance_criteria: [
      "Prototype files are created only in a safe prototype/sandbox/worktree location.",
      "The tiny CLI tool is implemented.",
      "The CLI accepts a text file path argument.",
      "The CLI outputs word count.",
      "The CLI outputs character count.",
      "The CLI outputs top 5 repeated words.",
      "At least one test fixture is included.",
      "Relevant tests/checks run.",
      "Evidence is generated.",
      "Vera-style summary is produced.",
      "No production implementation occurs automatically.",
    ],
    required_checks: ["node --test word-count-cli.test.mjs", "prototype diff scope check", "prototype secret scan"],
    approval_policy: {
      approval_required: true,
      implementation_allowed_without_approval: false,
      final_options: ["approve implementation", "request revision", "discard"],
    },
    evidence_requirements: [
      "structured spec",
      "run/task id or equivalent tracking id",
      "files created/changed",
      "commands run",
      "command results",
      "acceptance criteria pass/fail status",
      "risks/limitations",
      "readiness status",
    ],
  };
}

export function validatePhase29ABuildSpec(spec: Phase29ABuildSpec): void {
  if (spec.task_type !== "build_prototype") throw new Error("PHASE_29A_INVALID_TASK_TYPE");
  if (!spec.title.trim()) throw new Error("PHASE_29A_TITLE_REQUIRED");
  if (!spec.user_intent.trim()) throw new Error("PHASE_29A_USER_INTENT_REQUIRED");
  if (!spec.target_proof_task.trim()) throw new Error("PHASE_29A_TARGET_PROOF_TASK_REQUIRED");
  if (!spec.allowed_change_scope.length) throw new Error("PHASE_29A_ALLOWED_SCOPE_REQUIRED");
  if (!spec.disallowed_changes.length) throw new Error("PHASE_29A_DISALLOWED_CHANGES_REQUIRED");
  if (!spec.acceptance_criteria.length) throw new Error("PHASE_29A_ACCEPTANCE_CRITERIA_REQUIRED");
  if (!spec.required_checks.includes("node --test word-count-cli.test.mjs")) {
    throw new Error("PHASE_29A_REQUIRED_CLI_TEST_MISSING");
  }
  if (
    spec.approval_policy.approval_required !== true ||
    spec.approval_policy.implementation_allowed_without_approval !== false
  ) {
    throw new Error("PHASE_29A_APPROVAL_POLICY_VIOLATION");
  }
}

function buildPhase29AConsoleAssignment(
  spec: Phase29ABuildSpec,
  taskId: string,
): PrototypeLoopConsoleAssignment {
  return {
    assignment_type: "prototype_loop_v1_console_build",
    task_id: taskId,
    objective: spec.target_proof_task,
    acceptance_criteria: spec.acceptance_criteria,
    test_expectations: spec.required_checks,
    allowed_file_scope: spec.allowed_change_scope,
    risk_level: "low",
    evidence_requirements: spec.evidence_requirements,
    approval_policy: {
      approval_required: true,
      integration_allowed: false,
      implementation_policy: "Prototype only. User approval required before implementation.",
    },
    loop_limits: {
      max_implementation_loops: 1,
      max_repair_attempts_per_failing_gate: 1,
      max_revision_rounds: 0,
    },
    model_role_requirements: {
      vera: {
        role_id: "vera_command",
        endpoint: "http://127.0.0.1:8081/v1",
        model: "Nemotron-Nano-30B-A3B-NVFP4",
        repository_write_allowed: false,
        fallback_allowed: false,
      },
      console: {
        role_id: "console_default_worker",
        endpoint: "http://127.0.0.1:8082/v1",
        model: "Nemotron-Nano-30B-A3B-NVFP4",
        repository_write_allowed: true,
        fallback_allowed: false,
      },
      senior: {
        role_id: "console_senior_worker",
        status: "blocked_unproven",
        fallback_allowed: false,
      },
    },
    structured_build_request: {
      ...spec,
      original_user_request: spec.user_intent,
      clarification_behavior: {
        requires_clarification: false,
        clarification_questions: [],
        safe_default_rationale: [
          "The request matches the fixed Phase 29A proof task.",
          "Use the existing isolated prototype-loop workspace.",
          "Stop at explicit user approval before implementation.",
        ],
      },
    },
  };
}

function buildPhase29AVeraSummary(evidence: PrototypeLoopEvidence): Phase29AVeraSummary {
  const failedOrSkipped = [
    ...evidence.test_results.filter((result) => result.status !== "passed")
      .map((result) => `${result.command}: ${result.status}`),
    ...evidence.lint_typecheck_results.filter((result) => result.status !== "passed")
      .map((result) => `${result.command}: ${result.status}`),
  ];
  return {
    what_was_built: evidence.what_was_created,
    where_it_was_built: evidence.workspace_path,
    what_passed: evidence.gates
      .filter((gate) => gate.status === "passed")
      .map((gate) => `${gate.name}: ${gate.message}`),
    what_failed_or_was_skipped: failedOrSkipped.length > 0 ? failedOrSkipped : ["None."],
    risks_or_limitations: [
      evidence.risk_assessment,
      "Prototype is isolated and has not been integrated into production code.",
    ],
    approval_question: PHASE_29A_APPROVAL_QUESTION,
  };
}

function buildAcceptanceStatus(
  spec: Phase29ABuildSpec,
  evidence: PrototypeLoopEvidence,
): Phase29AEvidenceAddendum["acceptance_criteria_status"] {
  const thresholdPassed = evidence.acceptance_threshold.approval_allowed;
  return spec.acceptance_criteria.map((criterion) => ({
    criterion,
    status: thresholdPassed ? "passed" : "failed",
    evidence: thresholdPassed
      ? "Satisfied by isolated prototype files, command results, generated evidence, and approval gate."
      : "See failing command results or gate results in this evidence bundle.",
  }));
}

async function writePhase29AEvidenceAddendum(
  evidence: PrototypeLoopEvidence,
  input: {
    spec: Phase29ABuildSpec;
    consoleTracking: Phase29APrototypeLoopResult["console_tracking"];
    veraSummary: Phase29AVeraSummary;
  },
): Promise<PrototypeLoopEvidence & Phase29AEvidenceAddendum> {
  const enriched: PrototypeLoopEvidence & Phase29AEvidenceAddendum = {
    ...evidence,
    phase: "29A",
    structured_build_spec: input.spec,
    console_tracking: input.consoleTracking,
    acceptance_criteria_status: buildAcceptanceStatus(input.spec, evidence),
    risks_limitations: input.veraSummary.risks_or_limitations,
    readiness_status: evidence.status,
    threshold_engine_input: evidence.threshold_engine_input,
    threshold_engine_gates: evidence.threshold_engine_gates,
    threshold_engine_output: evidence.threshold_engine_output,
    vera_summary: input.veraSummary,
    approval_options: input.spec.approval_policy.final_options,
  };
  await fs.writeFile(enriched.evidence_path, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}
