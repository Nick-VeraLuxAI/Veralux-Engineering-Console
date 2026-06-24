import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { createRun, saveApprovalReport, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";

export type PrototypeImplementationPlanningStatus = "implementation_plan_recorded" | "blocked";
export type PrototypeImplementationPlanningNextAction = "awaiting_user_plan_approval" | "blocked";

export interface PrototypeImplementationPlanningRequest {
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  final_readiness_status: "ready_for_user_approval" | "passed_with_skips" | "failed" | "blocked" | string;
  requested_implementation_intent: string;
  production_mutation_allowed: boolean;
  safety_constraints: string[];
  user_note?: string;
}

export interface PrototypeImplementationPlanArtifact {
  schema_version: "veralux-console-prototype-implementation-plan/v1";
  implementation_plan_id: string;
  timestamp: string;
  planning_status: PrototypeImplementationPlanningStatus;
  accepted: boolean;
  blocked_reason?: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  final_readiness_status: string;
  production_mutation_allowed: false;
  approval_required_before_apply: true;
  proposed_implementation_summary: string;
  proposed_file_targets: string[];
  proposed_integration_strategy: string[];
  proposed_test_plan: string[];
  proposed_rollback_strategy: string[];
  risk_impact_notes: string[];
  safety_constraints: string[];
  explicit_non_actions: string[];
  next_expected_phase: "governed_implementation_apply_proposal";
  user_note?: string;
}

export interface PrototypeImplementationPlanningResult {
  planning_status: PrototypeImplementationPlanningStatus;
  accepted: boolean;
  blocked_reason?: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  next_action: PrototypeImplementationPlanningNextAction;
  plan_path: string;
  plan_artifact: PrototypeImplementationPlanArtifact;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  approval_decision_id: string;
  production_mutation_allowed: false;
  approval_required_before_apply: true;
  safety_notes: string[];
  vera_summary: string;
}

export interface RunPrototypeImplementationPlanningOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  planId?: () => string;
}

const SAFETY_NOTES = [
  "Phase 38 records an implementation plan only.",
  "No production source files are read, copied, patched, merged, deployed, or changed.",
  "No PR is created and no implementation executor is called.",
  "User approval is required before any later apply phase.",
];

const EXPLICIT_NON_ACTIONS = [
  "No files changed.",
  "No production code applied.",
  "No merge or deploy performed.",
  "No pull request created.",
  "No prototype files copied into production.",
];

const MUTATING_INTENT_PATTERN = /\b(apply|merge|deploy|patch|copy|commit|push|mutate|write\s+production)\b/i;

export async function runPrototypeImplementationPlanningV1(
  input: PrototypeImplementationPlanningRequest,
  options: RunPrototypeImplementationPlanningOptions = {},
): Promise<PrototypeImplementationPlanningResult> {
  const normalized = normalizeRequest(input);
  const implementationPlanId = options.planId?.() ?? randomUUID();
  const timestamp = (options.now ?? new Date()).toISOString();
  const blockedReason = validatePlanningRequest(normalized);
  const accepted = !blockedReason;
  const planningStatus: PrototypeImplementationPlanningStatus = accepted ? "implementation_plan_recorded" : "blocked";
  const nextAction: PrototypeImplementationPlanningNextAction = accepted ? "awaiting_user_plan_approval" : "blocked";
  const repoRoot = path.resolve(options.repoRoot ?? repoRootFromEvidencePath(normalized.evidence_path));
  const planPath = path.join(
    path.resolve(options.evidenceRoot ?? path.join(repoRoot, "evidence", "prototype-implementation-plans")),
    `${implementationPlanId}.json`,
  );

  let planningTaskId: string | null = null;
  let planningRunId: string | null = null;
  if (accepted) {
    const task = createTask({
      title: `Implementation plan for ${normalized.task_id}`,
      description: JSON.stringify({
        phase: "38",
        implementation_request_id: normalized.implementation_request_id,
        approval_decision_id: normalized.approval_decision_id,
        task_id: normalized.task_id,
        run_id: normalized.run_id,
        evidence_path: normalized.evidence_path,
      }, null, 2),
      targetRepoPath: repoRoot,
      priority: "normal",
      status: "queued",
    });
    const run = createRun(task.id, "prototype_implementation_planning_v1");
    planningTaskId = task.id;
    planningRunId = run.id;
    updateRun(run.id, {
      status: "planning",
      currentStep: "prototype_implementation_plan_recording",
      startedAt: timestamp,
      riskLevel: "low",
      governanceNotes: JSON.stringify({
        phase: "38",
        implementationRequestId: normalized.implementation_request_id,
        approvalDecisionId: normalized.approval_decision_id,
        productionMutationAllowed: false,
        approvalRequiredBeforeApply: true,
      }),
    });
  }

  const artifact = buildPlanArtifact({
    input: normalized,
    implementationPlanId,
    timestamp,
    planningStatus,
    accepted,
    blockedReason,
  });
  await writePlanArtifact(planPath, artifact);

  if (accepted && planningTaskId && planningRunId) {
    updateTask(planningTaskId, { status: "waiting_for_approval" });
    updateRun(planningRunId, {
      status: "waiting_for_approval",
      currentStep: "awaiting_user_plan_approval",
      completedAt: timestamp,
      agentMessage: artifact.proposed_implementation_summary,
    });
    saveApprovalReport(planningRunId, JSON.stringify({
      taskSummary: artifact.proposed_implementation_summary,
      branchName: null,
      changedFiles: [],
      riskLevel: "low",
      governanceIssues: artifact.risk_impact_notes,
      qualityGateResults: [],
      diffSummary: "Planning only. No diff was generated.",
      recommendedNextAction: "Review the implementation plan before any governed apply phase.",
      canApprove: true,
    }));
  }

  return {
    planning_status: planningStatus,
    accepted,
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    implementation_plan_id: implementationPlanId,
    implementation_request_id: normalized.implementation_request_id,
    next_action: nextAction,
    plan_path: planPath,
    plan_artifact: artifact,
    task_id: normalized.task_id,
    run_id: normalized.run_id,
    evidence_path: normalized.evidence_path,
    ...(normalized.revision_task_id ? { revision_task_id: normalized.revision_task_id } : {}),
    ...(normalized.revision_run_id ? { revision_run_id: normalized.revision_run_id } : {}),
    ...(normalized.revision_evidence_path ? { revision_evidence_path: normalized.revision_evidence_path } : {}),
    approval_decision_id: normalized.approval_decision_id,
    production_mutation_allowed: false,
    approval_required_before_apply: true,
    safety_notes: [...SAFETY_NOTES],
    vera_summary: summaryForResult(blockedReason),
  };
}

function normalizeRequest(input: PrototypeImplementationPlanningRequest): PrototypeImplementationPlanningRequest {
  return {
    ...input,
    implementation_request_id: input.implementation_request_id?.trim() ?? "",
    approval_decision_id: input.approval_decision_id?.trim() ?? "",
    task_id: input.task_id?.trim() ?? "",
    run_id: input.run_id?.trim() ?? "",
    evidence_path: input.evidence_path?.trim() ?? "",
    revision_task_id: input.revision_task_id?.trim() || undefined,
    revision_run_id: input.revision_run_id?.trim() || undefined,
    revision_evidence_path: input.revision_evidence_path?.trim() || undefined,
    final_readiness_status: input.final_readiness_status?.trim() ?? "",
    requested_implementation_intent: input.requested_implementation_intent?.trim() ?? "",
    safety_constraints: Array.isArray(input.safety_constraints)
      ? input.safety_constraints.map((constraint) => constraint.trim()).filter(Boolean)
      : [],
    user_note: input.user_note?.trim() || undefined,
  };
}

function validatePlanningRequest(input: PrototypeImplementationPlanningRequest): string | null {
  if (!input.implementation_request_id) return "implementation_request_id is required.";
  if (!input.approval_decision_id) return "approval_decision_id is required.";
  if (!input.task_id) return "task_id is required.";
  if (!input.run_id) return "run_id is required.";
  if (!input.evidence_path) return "evidence_path is required.";
  if (input.final_readiness_status !== "ready_for_user_approval" && input.final_readiness_status !== "passed_with_skips") {
    return "final_readiness_status must be ready_for_user_approval or passed_with_skips.";
  }
  if (input.requested_implementation_intent !== "prepare_governed_implementation_plan") {
    return "requested_implementation_intent must be prepare_governed_implementation_plan.";
  }
  if (input.production_mutation_allowed !== false) return "production_mutation_allowed must be false.";
  if (input.safety_constraints.length === 0) return "safety_constraints are required.";
  if (input.safety_constraints.some((constraint) =>
    /\b(can|may|allowed|allow)\b.*\b(production|copy|deploy|merge|apply|patch)\b/i.test(constraint)
    || /\b(production|copy|deploy|merge|apply|patch)\b.*\b(can|may|allowed|allow)\b/i.test(constraint)
  )) {
    return "safety_constraints are contradictory or mutating.";
  }
  if (MUTATING_INTENT_PATTERN.test(input.requested_implementation_intent) || (input.user_note && MUTATING_INTENT_PATTERN.test(input.user_note))) {
    return "Phase 38 cannot apply, merge, deploy, patch, copy, commit, push, or mutate production files.";
  }
  return null;
}

function buildPlanArtifact(input: {
  input: PrototypeImplementationPlanningRequest;
  implementationPlanId: string;
  timestamp: string;
  planningStatus: PrototypeImplementationPlanningStatus;
  accepted: boolean;
  blockedReason: string | null;
}): PrototypeImplementationPlanArtifact {
  return {
    schema_version: "veralux-console-prototype-implementation-plan/v1",
    implementation_plan_id: input.implementationPlanId,
    timestamp: input.timestamp,
    planning_status: input.planningStatus,
    accepted: input.accepted,
    ...(input.blockedReason ? { blocked_reason: input.blockedReason } : {}),
    implementation_request_id: input.input.implementation_request_id,
    approval_decision_id: input.input.approval_decision_id,
    task_id: input.input.task_id,
    run_id: input.input.run_id,
    evidence_path: input.input.evidence_path,
    ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
    ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
    ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
    final_readiness_status: input.input.final_readiness_status,
    production_mutation_allowed: false,
    approval_required_before_apply: true,
    proposed_implementation_summary:
      "Plan a governed production implementation of the approved word-count CLI prototype behavior without applying code in Phase 38.",
    proposed_file_targets: [
      "Production CLI or application entrypoint to be selected in a later planning review.",
      "Production test file(s) to be selected in a later planning review.",
      "Documentation or usage notes if required by the later governed apply phase.",
    ],
    proposed_integration_strategy: [
      "Review prototype evidence and final readiness before selecting production targets.",
      "Prepare a separate implementation patch only after user approval of an apply phase.",
      "Keep prototype artifacts as reference material; do not copy them directly without review.",
    ],
    proposed_test_plan: [
      "Add or update unit tests for word count, character count, and top repeated words.",
      "Run the relevant package test command selected during the later implementation phase.",
      "Re-run safety checks before any apply proposal is accepted.",
    ],
    proposed_rollback_strategy: [
      "Keep implementation changes isolated in a later reviewed patch.",
      "Revert only the later implementation patch if validation fails.",
      "Preserve prototype evidence and approval decision records for audit.",
    ],
    risk_impact_notes: [
      "Production file targets are not selected in Phase 38.",
      "The approved prototype may require adaptation before production use.",
      "User approval is required before any apply phase can mutate files.",
    ],
    safety_constraints: input.input.safety_constraints,
    explicit_non_actions: EXPLICIT_NON_ACTIONS,
    next_expected_phase: "governed_implementation_apply_proposal",
    ...(input.input.user_note ? { user_note: input.input.user_note } : {}),
  };
}

async function writePlanArtifact(planPath: string, artifact: PrototypeImplementationPlanArtifact): Promise<void> {
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(planPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function repoRootFromEvidencePath(evidencePath: string): string {
  if (!evidencePath.trim()) return process.cwd();
  const resolved = path.resolve(evidencePath);
  const marker = `${path.sep}evidence${path.sep}`;
  const index = resolved.indexOf(marker);
  if (index === -1) return process.cwd();
  return resolved.slice(0, index);
}

function summaryForResult(blockedReason: string | null): string {
  if (blockedReason) return `Console blocked implementation planning because: ${blockedReason}`;
  return "Console created an implementation plan for the approved prototype. No production code was changed. The next step is user approval of a separate governed apply phase.";
}
