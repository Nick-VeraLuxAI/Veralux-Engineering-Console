import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { createRun, saveApprovalReport, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";

export type PrototypeApplyProposalStatus = "apply_proposal_recorded" | "blocked";
export type PrototypeApplyProposalNextAction = "awaiting_user_apply_approval" | "blocked";

export interface PrototypeApplyProposalRequest {
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  final_readiness_status: "ready_for_user_approval" | "passed_with_skips" | "failed" | "blocked" | string;
  production_mutation_allowed: boolean;
  approval_required_before_apply: boolean;
  requested_apply_intent: string;
  safety_constraints: string[];
  user_note?: string;
}

export interface PrototypeApplyProposalArtifact {
  schema_version: "veralux-console-prototype-apply-proposal/v1";
  apply_proposal_id: string;
  timestamp: string;
  apply_proposal_status: PrototypeApplyProposalStatus;
  accepted: boolean;
  blocked_reason?: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  final_readiness_status: string;
  production_mutation_allowed: false;
  apply_allowed: false;
  user_approval_required: true;
  approval_required_before_apply: true;
  proposed_apply_summary: string;
  proposed_target_files: string[];
  proposed_patch_strategy: string[];
  proposed_test_commands: string[];
  required_pre_apply_checks: string[];
  required_post_apply_checks: string[];
  rollback_strategy: string[];
  risk_classification: "low" | "medium" | "high";
  risk_impact_notes: string[];
  safety_constraints: string[];
  explicit_non_actions: string[];
  next_expected_phase: "governed_apply_approval_controlled_apply_execution";
  user_note?: string;
}

export interface PrototypeApplyProposalResult {
  apply_proposal_status: PrototypeApplyProposalStatus;
  accepted: boolean;
  blocked_reason?: string;
  apply_proposal_id: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  next_action: PrototypeApplyProposalNextAction;
  proposal_path: string;
  proposal_artifact: PrototypeApplyProposalArtifact;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  production_mutation_allowed: false;
  apply_allowed: false;
  user_approval_required: true;
  approval_required_before_apply: true;
  safety_notes: string[];
  vera_summary: string;
}

export interface RunPrototypeApplyProposalOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  proposalId?: () => string;
}

const SAFETY_NOTES = [
  "Phase 40 records a governed apply proposal only.",
  "No production source files are read, copied, patched, merged, deployed, committed, pushed, or changed.",
  "No pull request is created and no implementation executor is called.",
  "Explicit user approval is required before any later controlled apply phase.",
];

const EXPLICIT_NON_ACTIONS = [
  "No files changed.",
  "No patches applied.",
  "No prototype files copied.",
  "No commit created.",
  "No pull request created.",
  "No merge or deploy performed.",
];

const MUTATING_INTENT_PATTERN = /\b(apply|merge|deploy|patch|copy|commit|push|mutate|write\s+production)\b/i;
const BYPASS_APPROVAL_PATTERN = /\b(bypass|skip|without|no)\b.*\b(user\s+)?approval\b/i;
const EXECUTE_IMPLEMENTATION_PATTERN = /\b(execute|run|perform|start)\b.*\b(implementation|apply|patch)\b/i;
const CONTRADICTORY_SAFETY_PATTERN =
  /\b(can|may|allowed|allow)\b.*\b(production|copy|deploy|merge|apply|patch|commit|push)\b/i;
const CONTRADICTORY_SAFETY_REVERSED_PATTERN =
  /\b(production|copy|deploy|merge|apply|patch|commit|push)\b.*\b(can|may|allowed|allow)\b/i;

export async function runPrototypeApplyProposalV1(
  input: PrototypeApplyProposalRequest,
  options: RunPrototypeApplyProposalOptions = {},
): Promise<PrototypeApplyProposalResult> {
  const normalized = normalizeRequest(input);
  const applyProposalId = options.proposalId?.() ?? randomUUID();
  const timestamp = (options.now ?? new Date()).toISOString();
  const blockedReason = validateApplyProposalRequest(normalized);
  const accepted = !blockedReason;
  const applyProposalStatus: PrototypeApplyProposalStatus = accepted ? "apply_proposal_recorded" : "blocked";
  const nextAction: PrototypeApplyProposalNextAction = accepted ? "awaiting_user_apply_approval" : "blocked";
  const repoRoot = path.resolve(options.repoRoot ?? repoRootFromPlanPathOrEvidencePath(normalized.plan_path, normalized.evidence_path));
  const proposalPath = path.join(
    path.resolve(options.evidenceRoot ?? path.join(repoRoot, "evidence", "prototype-apply-proposals")),
    `${applyProposalId}.json`,
  );

  let proposalTaskId: string | null = null;
  let proposalRunId: string | null = null;
  if (accepted) {
    const task = createTask({
      title: `Apply proposal for ${normalized.implementation_plan_id}`,
      description: JSON.stringify({
        phase: "40",
        implementation_plan_id: normalized.implementation_plan_id,
        implementation_request_id: normalized.implementation_request_id,
        approval_decision_id: normalized.approval_decision_id,
        task_id: normalized.task_id,
        run_id: normalized.run_id,
        evidence_path: normalized.evidence_path,
        plan_path: normalized.plan_path,
      }, null, 2),
      targetRepoPath: repoRoot,
      priority: "normal",
      status: "queued",
    });
    const run = createRun(task.id, "prototype_apply_proposal_v1");
    proposalTaskId = task.id;
    proposalRunId = run.id;
    updateRun(run.id, {
      status: "planning",
      currentStep: "prototype_apply_proposal_recording",
      startedAt: timestamp,
      riskLevel: "medium",
      governanceNotes: JSON.stringify({
        phase: "40",
        implementationPlanId: normalized.implementation_plan_id,
        implementationRequestId: normalized.implementation_request_id,
        approvalDecisionId: normalized.approval_decision_id,
        productionMutationAllowed: false,
        applyAllowed: false,
        userApprovalRequired: true,
      }),
    });
  }

  const artifact = buildProposalArtifact({
    input: normalized,
    applyProposalId,
    timestamp,
    applyProposalStatus,
    accepted,
    blockedReason,
  });
  await writeProposalArtifact(proposalPath, artifact);

  if (accepted && proposalTaskId && proposalRunId) {
    updateTask(proposalTaskId, { status: "waiting_for_approval" });
    updateRun(proposalRunId, {
      status: "waiting_for_approval",
      currentStep: "awaiting_user_apply_approval",
      completedAt: timestamp,
      agentMessage: artifact.proposed_apply_summary,
    });
    saveApprovalReport(proposalRunId, JSON.stringify({
      taskSummary: artifact.proposed_apply_summary,
      branchName: null,
      changedFiles: [],
      riskLevel: artifact.risk_classification,
      governanceIssues: artifact.risk_impact_notes,
      qualityGateResults: [],
      diffSummary: "Apply proposal only. No diff was generated or applied.",
      recommendedNextAction: "Review and explicitly approve before any controlled apply phase.",
      canApprove: true,
    }));
  }

  return {
    apply_proposal_status: applyProposalStatus,
    accepted,
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    apply_proposal_id: applyProposalId,
    implementation_plan_id: normalized.implementation_plan_id,
    implementation_request_id: normalized.implementation_request_id,
    approval_decision_id: normalized.approval_decision_id,
    next_action: nextAction,
    proposal_path: proposalPath,
    proposal_artifact: artifact,
    task_id: normalized.task_id,
    run_id: normalized.run_id,
    evidence_path: normalized.evidence_path,
    ...(normalized.revision_task_id ? { revision_task_id: normalized.revision_task_id } : {}),
    ...(normalized.revision_run_id ? { revision_run_id: normalized.revision_run_id } : {}),
    ...(normalized.revision_evidence_path ? { revision_evidence_path: normalized.revision_evidence_path } : {}),
    plan_path: normalized.plan_path,
    production_mutation_allowed: false,
    apply_allowed: false,
    user_approval_required: true,
    approval_required_before_apply: true,
    safety_notes: [...SAFETY_NOTES],
    vera_summary: summaryForResult(blockedReason),
  };
}

function normalizeRequest(input: PrototypeApplyProposalRequest): PrototypeApplyProposalRequest {
  return {
    ...input,
    implementation_plan_id: input.implementation_plan_id?.trim() ?? "",
    implementation_request_id: input.implementation_request_id?.trim() ?? "",
    approval_decision_id: input.approval_decision_id?.trim() ?? "",
    task_id: input.task_id?.trim() ?? "",
    run_id: input.run_id?.trim() ?? "",
    evidence_path: input.evidence_path?.trim() ?? "",
    revision_task_id: input.revision_task_id?.trim() || undefined,
    revision_run_id: input.revision_run_id?.trim() || undefined,
    revision_evidence_path: input.revision_evidence_path?.trim() || undefined,
    plan_path: input.plan_path?.trim() ?? "",
    final_readiness_status: input.final_readiness_status?.trim() ?? "",
    requested_apply_intent: input.requested_apply_intent?.trim() ?? "",
    safety_constraints: Array.isArray(input.safety_constraints)
      ? input.safety_constraints.map((constraint) => constraint.trim()).filter(Boolean)
      : [],
    user_note: input.user_note?.trim() || undefined,
  };
}

function validateApplyProposalRequest(input: PrototypeApplyProposalRequest): string | null {
  if (!input.implementation_plan_id) return "implementation_plan_id is required.";
  if (!input.implementation_request_id) return "implementation_request_id is required.";
  if (!input.approval_decision_id) return "approval_decision_id is required.";
  if (!input.task_id) return "task_id is required.";
  if (!input.run_id) return "run_id is required.";
  if (!input.evidence_path) return "evidence_path is required.";
  if (!input.plan_path) return "plan_path is required.";
  if (input.final_readiness_status !== "ready_for_user_approval" && input.final_readiness_status !== "passed_with_skips") {
    return "final_readiness_status must be ready_for_user_approval or passed_with_skips.";
  }
  if (input.production_mutation_allowed !== false) return "production_mutation_allowed must be false.";
  if (input.approval_required_before_apply !== true) return "approval_required_before_apply must be true.";
  if (input.requested_apply_intent !== "prepare_governed_apply_proposal") {
    return "requested_apply_intent must be prepare_governed_apply_proposal.";
  }
  if (input.safety_constraints.length === 0) return "safety_constraints are required.";
  if (input.safety_constraints.some(isContradictorySafetyConstraint)) {
    return "safety_constraints are contradictory or mutating.";
  }
  const userIntent = safeUserIntentText(input.user_note ?? "");
  if (
    MUTATING_INTENT_PATTERN.test(userIntent) ||
    BYPASS_APPROVAL_PATTERN.test(userIntent) ||
    EXECUTE_IMPLEMENTATION_PATTERN.test(userIntent)
  ) {
    return "Phase 40 cannot apply, merge, deploy, patch, copy, commit, push, bypass approval, execute implementation, or mutate production files.";
  }
  return null;
}

function isContradictorySafetyConstraint(constraint: string): boolean {
  return CONTRADICTORY_SAFETY_PATTERN.test(constraint) || CONTRADICTORY_SAFETY_REVERSED_PATTERN.test(constraint);
}

function safeUserIntentText(value: string): string {
  return value.replace(/\bapply\s+proposal\b/gi, "proposal");
}

function buildProposalArtifact(input: {
  input: PrototypeApplyProposalRequest;
  applyProposalId: string;
  timestamp: string;
  applyProposalStatus: PrototypeApplyProposalStatus;
  accepted: boolean;
  blockedReason: string | null;
}): PrototypeApplyProposalArtifact {
  return {
    schema_version: "veralux-console-prototype-apply-proposal/v1",
    apply_proposal_id: input.applyProposalId,
    timestamp: input.timestamp,
    apply_proposal_status: input.applyProposalStatus,
    accepted: input.accepted,
    ...(input.blockedReason ? { blocked_reason: input.blockedReason } : {}),
    implementation_plan_id: input.input.implementation_plan_id,
    implementation_request_id: input.input.implementation_request_id,
    approval_decision_id: input.input.approval_decision_id,
    task_id: input.input.task_id,
    run_id: input.input.run_id,
    evidence_path: input.input.evidence_path,
    ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
    ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
    ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
    plan_path: input.input.plan_path,
    final_readiness_status: input.input.final_readiness_status,
    production_mutation_allowed: false,
    apply_allowed: false,
    user_approval_required: true,
    approval_required_before_apply: true,
    proposed_apply_summary:
      `Prepare a later controlled apply phase for implementation plan ${input.input.implementation_plan_id}. No code is applied in Phase 40.`,
    proposed_target_files: [
      "Production CLI or application entrypoint identified during the later controlled apply phase.",
      "Production unit/integration test files selected during the later controlled apply phase.",
      "Documentation or operator notes if required by the approved implementation plan.",
    ],
    proposed_patch_strategy: [
      "Review the implementation plan artifact and prototype evidence before selecting exact production files.",
      "Prepare a separate reviewable patch only after explicit user approval of the apply proposal.",
      "Keep generated prototype files as reference evidence; do not copy them directly into production.",
      "Run pre-apply checks before any controlled apply execution begins.",
    ],
    proposed_test_commands: [
      "npm test -- src/lib/engineer-console/prototype-loop",
      "Run package-specific unit tests for the production files selected in the controlled apply phase.",
      "Run any acceptance checks listed in the implementation plan before and after controlled apply.",
    ],
    required_pre_apply_checks: [
      "Confirm user approval for the apply proposal is recorded.",
      "Confirm production_mutation_allowed remains false until the controlled apply phase begins.",
      "Confirm target files are selected from the reviewed plan, not copied from prototype artifacts.",
      "Confirm rollback instructions are available before applying any later patch.",
    ],
    required_post_apply_checks: [
      "Run the proposed test commands after any later controlled apply phase.",
      "Verify no generated prototype files were copied into production.",
      "Verify evidence, plan, approval, and apply records preserve lineage.",
    ],
    rollback_strategy: [
      "Keep any later implementation patch isolated and reviewable.",
      "If validation fails after a later controlled apply, revert only that reviewed patch.",
      "Preserve prototype evidence, implementation plan, and apply proposal artifacts for audit.",
    ],
    risk_classification: "medium",
    risk_impact_notes: [
      "Phase 40 does not inspect or mutate production source files.",
      "Exact production file targets must be reviewed before a later controlled apply phase.",
      "Applying implementation changes later may affect runtime behavior and requires explicit user approval.",
    ],
    safety_constraints: input.input.safety_constraints,
    explicit_non_actions: EXPLICIT_NON_ACTIONS,
    next_expected_phase: "governed_apply_approval_controlled_apply_execution",
    ...(input.input.user_note ? { user_note: input.input.user_note } : {}),
  };
}

async function writeProposalArtifact(proposalPath: string, artifact: PrototypeApplyProposalArtifact): Promise<void> {
  await fs.mkdir(path.dirname(proposalPath), { recursive: true });
  await fs.writeFile(proposalPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function repoRootFromPlanPathOrEvidencePath(planPath: string, evidencePath: string): string {
  return repoRootFromEvidencePath(planPath) ?? repoRootFromEvidencePath(evidencePath) ?? process.cwd();
}

function repoRootFromEvidencePath(value: string): string | null {
  if (!value.trim()) return null;
  const resolved = path.resolve(value);
  const marker = `${path.sep}evidence${path.sep}`;
  const index = resolved.indexOf(marker);
  if (index === -1) return null;
  return resolved.slice(0, index);
}

function summaryForResult(blockedReason: string | null): string {
  if (blockedReason) return `Console blocked the apply proposal because: ${blockedReason}`;
  return "Console created a governed apply proposal for the implementation plan. No production code was changed. The next step is explicit user approval before any controlled apply phase.";
}
