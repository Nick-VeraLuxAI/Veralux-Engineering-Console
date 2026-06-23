import fs from "fs/promises";
import path from "path";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";
import {
  runPrototypeLoopV1,
  type EvidenceStatus,
  type PrototypeLoopConsoleAssignment,
  type PrototypeLoopEvidence,
} from "./prototype-loop-v1";

export const PROTOTYPE_REVISION_APPROVAL_QUESTION =
  "Do you want to approve implementation, request another revision, or discard this prototype?";

export interface PrototypeLoopRevisionRequest {
  parent_task_id: string;
  parent_run_id: string;
  parent_evidence_path: string;
  revision_request: {
    reason: string;
    failed_gates: string[];
    acceptance_criteria_not_met: string[];
    requested_changes: string[];
    safety_notes: string[];
  };
  max_revision_rounds: number;
}

export interface PrototypeLoopRevisionTracking {
  parent_task_id: string;
  parent_run_id: string;
  revision_task_id: string;
  revision_run_id: string;
}

export interface PrototypeLoopRevisionResult {
  status: EvidenceStatus;
  revision_tracking: PrototypeLoopRevisionTracking;
  workspace_path: string;
  evidence_path: string;
  threshold_engine_output: PrototypeLoopEvidence["threshold_engine_output"] | null;
  approval_required: true;
  integration_allowed: false;
  vera_summary: string;
  approval_options: ["approve implementation", "request another revision", "discard"];
  blocked_reason: string | null;
}

interface RunPrototypeLoopRevisionOptions {
  now?: Date;
}

type ParentEvidence = PrototypeLoopEvidence & {
  integration_allowed?: boolean;
  approval_required?: boolean;
  threshold_engine_output?: PrototypeLoopEvidence["threshold_engine_output"];
  console_tracking?: {
    task_id: string;
    run_id: string;
    task_status: string;
    run_status: string;
  };
};

const SAFETY_GATE_IDS = new Set([
  "scope_check",
  "diff_scope",
  "secret_scan",
  "no_integration",
  "approval_required",
  "role_policy",
  "no_model_fallback",
  "senior_super_not_used",
  "prototype_workspace_scope",
  "evidence_bundle",
]);

export async function runPrototypeLoopRevision(
  input: PrototypeLoopRevisionRequest,
  options: RunPrototypeLoopRevisionOptions = {},
): Promise<PrototypeLoopRevisionResult> {
  const preflight = await validateRevisionRequest(input);
  if (!preflight.ok) {
    return blockedRevisionResult(input, preflight.reason);
  }

  const parentEvidence = preflight.parentEvidence;
  const repoRoot = repoRootFromEvidencePath(preflight.parentEvidencePath);
  const revisionTask = createTask({
    title: `Revision for ${input.parent_task_id}`,
    description: JSON.stringify({
      phase: "33",
      parent_task_id: input.parent_task_id,
      parent_run_id: input.parent_run_id,
      parent_evidence_path: input.parent_evidence_path,
      revision_request: input.revision_request,
    }, null, 2),
    targetRepoPath: repoRoot,
    priority: "normal",
    status: "queued",
  });
  const revisionRun = createRun(revisionTask.id, "prototype_loop_v1_revision");
  updateRun(revisionRun.id, {
    status: "generating_patch",
    currentStep: "prototype_loop_v1_revision_build",
    startedAt: (options.now ?? new Date()).toISOString(),
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      phase: "33",
      parentTaskId: input.parent_task_id,
      parentRunId: input.parent_run_id,
      approvalRequired: true,
      integrationAllowed: false,
      revisionRoundCap: 1,
    }),
  });

  const assignment = buildRevisionAssignment(parentEvidence, input, revisionTask.id);
  const evidence = await runPrototypeLoopV1(assignment, {
    repoRoot,
    now: options.now,
  });
  const enrichedEvidence = await writeRevisionEvidenceAddendum(evidence, {
    parentEvidence,
    input,
    revisionTaskId: revisionTask.id,
    revisionRunId: revisionRun.id,
  });

  saveQualityGateResults(revisionRun.id, [
    ...enrichedEvidence.test_results,
    ...enrichedEvidence.lint_typecheck_results,
  ]);

  const approvalAllowed = enrichedEvidence.acceptance_threshold.approval_allowed;
  const taskStatus = approvalAllowed ? "waiting_for_approval" : "failed";
  const runStatus = approvalAllowed ? "waiting_for_approval" : "failed";
  updateTask(revisionTask.id, { status: taskStatus });
  updateRun(revisionRun.id, {
    status: runStatus,
    currentStep: "awaiting_user_approval",
    completedAt: (options.now ?? new Date()).toISOString(),
    agentMessage: enrichedEvidence.what_was_created,
  });

  saveApprovalReport(revisionRun.id, JSON.stringify({
    taskSummary: `Revision for ${input.parent_task_id}: ${input.revision_request.reason}`,
    branchName: null,
    changedFiles: enrichedEvidence.files_created_or_changed,
    riskLevel: "low",
    governanceIssues: enrichedEvidence.risks_limitations,
    qualityGateResults: [],
    diffSummary: enrichedEvidence.patch_diff_summary,
    recommendedNextAction: PROTOTYPE_REVISION_APPROVAL_QUESTION,
    canApprove: enrichedEvidence.acceptance_threshold.approval_allowed,
  }));

  return {
    status: enrichedEvidence.status,
    revision_tracking: {
      parent_task_id: input.parent_task_id,
      parent_run_id: input.parent_run_id,
      revision_task_id: revisionTask.id,
      revision_run_id: revisionRun.id,
    },
    workspace_path: enrichedEvidence.workspace_path,
    evidence_path: enrichedEvidence.evidence_path,
    threshold_engine_output: enrichedEvidence.threshold_engine_output,
    approval_required: true,
    integration_allowed: false,
    vera_summary: buildRevisionVeraSummary(enrichedEvidence, input),
    approval_options: ["approve implementation", "request another revision", "discard"],
    blocked_reason: null,
  };
}

async function validateRevisionRequest(input: PrototypeLoopRevisionRequest): Promise<
  | { ok: true; parentEvidence: ParentEvidence; parentEvidencePath: string }
  | { ok: false; reason: string }
> {
  if (!input.parent_task_id?.trim()) return { ok: false, reason: "parent_task_id is required." };
  if (!input.parent_run_id?.trim()) return { ok: false, reason: "parent_run_id is required." };
  if (!input.parent_evidence_path?.trim()) return { ok: false, reason: "parent_evidence_path is required." };
  if (input.max_revision_rounds !== 1) return { ok: false, reason: "max_revision_rounds must be exactly 1 for Phase 33." };
  const reason = input.revision_request?.reason?.trim();
  const requestedChanges = input.revision_request?.requested_changes ?? [];
  if (!reason && requestedChanges.length === 0) {
    return { ok: false, reason: "revision_request is empty or unclear." };
  }
  if (requestedChanges.some(isUnsafeRequestedChange)) {
    return { ok: false, reason: "requested changes would target production files or leave the safe prototype workspace." };
  }

  const parentEvidencePath = path.resolve(input.parent_evidence_path);
  if (!isEvidenceBundlePath(parentEvidencePath)) {
    return { ok: false, reason: "parent_evidence_path must point to evidence/prototype-loop-v1." };
  }

  let parentEvidence: ParentEvidence;
  try {
    parentEvidence = JSON.parse(await fs.readFile(parentEvidencePath, "utf8")) as ParentEvidence;
  } catch {
    return { ok: false, reason: "parent evidence cannot be read." };
  }

  if (parentEvidence.task_id !== input.parent_task_id) {
    return { ok: false, reason: "parent evidence task id does not match parent_task_id." };
  }
  if (parentEvidence.console_tracking?.run_id && parentEvidence.console_tracking.run_id !== input.parent_run_id) {
    return { ok: false, reason: "parent evidence run id does not match parent_run_id." };
  }
  if (parentEvidence.integration_allowed === true || parentEvidence.threshold_engine_output?.integration_allowed === true) {
    return { ok: false, reason: "parent evidence unexpectedly allows integration." };
  }
  if (parentEvidence.approval_required === false || parentEvidence.threshold_engine_output?.approval_required === false) {
    return { ok: false, reason: "parent evidence does not require approval." };
  }
  if (parentHasSafetyFailure(parentEvidence)) {
    return { ok: false, reason: "parent evidence indicates a safety gate failure." };
  }

  return { ok: true, parentEvidence, parentEvidencePath };
}

function buildRevisionAssignment(
  parentEvidence: ParentEvidence,
  input: PrototypeLoopRevisionRequest,
  revisionTaskId: string,
): PrototypeLoopConsoleAssignment {
  const parentAssignment = parentEvidence.console_assignment;
  return {
    ...parentAssignment,
    task_id: revisionTaskId,
    objective: `${parentAssignment.objective} Revision: ${input.revision_request.reason}`,
    acceptance_criteria: [
      ...parentAssignment.acceptance_criteria,
      ...input.revision_request.acceptance_criteria_not_met,
      ...input.revision_request.requested_changes,
    ],
    approval_policy: {
      approval_required: true,
      integration_allowed: false,
      implementation_policy: "Prototype revision only. User approval required before implementation.",
    },
    loop_limits: {
      max_implementation_loops: 1,
      max_repair_attempts_per_failing_gate: 1,
      max_revision_rounds: 1,
    },
    structured_build_request: {
      ...parentAssignment.structured_build_request,
      original_user_request: parentEvidence.original_user_request,
      phase: "33",
      parent_task_id: input.parent_task_id,
      parent_run_id: input.parent_run_id,
      parent_evidence_path: input.parent_evidence_path,
      revision_request: input.revision_request,
    },
  };
}

async function writeRevisionEvidenceAddendum(
  evidence: PrototypeLoopEvidence,
  input: {
    parentEvidence: ParentEvidence;
    input: PrototypeLoopRevisionRequest;
    revisionTaskId: string;
    revisionRunId: string;
  },
): Promise<PrototypeLoopEvidence & {
  phase: "33";
  parent_task_id: string;
  parent_run_id: string;
  parent_evidence_path: string;
  revision_task_id: string;
  revision_run_id: string;
  revision_request: PrototypeLoopRevisionRequest["revision_request"];
  revision_tracking: PrototypeLoopRevisionTracking;
  risks_limitations: string[];
  final_vera_summary: string;
}> {
  const enriched = {
    ...evidence,
    phase: "33" as const,
    parent_task_id: input.input.parent_task_id,
    parent_run_id: input.input.parent_run_id,
    parent_evidence_path: input.input.parent_evidence_path,
    revision_task_id: input.revisionTaskId,
    revision_run_id: input.revisionRunId,
    revision_request: input.input.revision_request,
    revision_tracking: {
      parent_task_id: input.input.parent_task_id,
      parent_run_id: input.input.parent_run_id,
      revision_task_id: input.revisionTaskId,
      revision_run_id: input.revisionRunId,
    },
    risks_limitations: [
      evidence.risk_assessment,
      "Revision stayed isolated in a new prototype workspace.",
      "No production implementation was performed.",
    ],
    final_vera_summary: buildRevisionVeraSummary(evidence, input.input),
  };
  await fs.writeFile(enriched.evidence_path, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

function blockedRevisionResult(
  input: PrototypeLoopRevisionRequest,
  reason: string,
): PrototypeLoopRevisionResult {
  return {
    status: "blocked",
    revision_tracking: {
      parent_task_id: input.parent_task_id ?? "",
      parent_run_id: input.parent_run_id ?? "",
      revision_task_id: "",
      revision_run_id: "",
    },
    workspace_path: "",
    evidence_path: "",
    threshold_engine_output: null,
    approval_required: true,
    integration_allowed: false,
    vera_summary: [
      "Prototype revision is blocked.",
      `Reason: ${reason}`,
      "No revision workspace was created.",
      "No production implementation occurred.",
      PROTOTYPE_REVISION_APPROVAL_QUESTION,
    ].join("\n"),
    approval_options: ["approve implementation", "request another revision", "discard"],
    blocked_reason: reason,
  };
}

function buildRevisionVeraSummary(
  evidence: PrototypeLoopEvidence,
  input: PrototypeLoopRevisionRequest,
): string {
  return [
    `Revision reason: ${input.revision_request.reason}`,
    `Parent task/run: ${input.parent_task_id} / ${input.parent_run_id}`,
    `Revision task evidence: ${evidence.evidence_path}`,
    `Revision readiness status: ${evidence.status}`,
    `Checks passed: ${evidence.passed_gates.join(", ") || "none"}`,
    `Failed/skipped gates: ${[...evidence.failed_gates, ...evidence.skipped_gates].join(", ") || "none"}`,
    "Risks/limitations: revision is isolated, approval is required, and integration is disallowed.",
    PROTOTYPE_REVISION_APPROVAL_QUESTION,
  ].join("\n");
}

function parentHasSafetyFailure(evidence: ParentEvidence): boolean {
  if (evidence.secret_scan_result?.status === "failed") return true;
  if (evidence.diff_scope_check?.status === "failed") return true;
  const threshold = evidence.threshold_engine_output ?? evidence.acceptance_threshold;
  const blockedGates = threshold?.blocked_gates ?? [];
  const failedSafetyGate = threshold?.normalized_gates?.some((gate) => (
    gate.required
    && (gate.status === "failed" || gate.status === "blocked")
    && (gate.category === "safety" || gate.category === "approval" || gate.category === "role" || gate.category === "workspace")
  )) ?? false;
  return failedSafetyGate || blockedGates.some((gate) => SAFETY_GATE_IDS.has(gate));
}

function isUnsafeRequestedChange(change: string): boolean {
  const normalized = change.toLowerCase();
  return normalized.includes("production")
    || normalized.includes("src/")
    || normalized.includes("app/")
    || normalized.includes("package.json")
    || normalized.includes("../")
    || normalized.includes("..\\")
    || normalized.includes(".env");
}

function isEvidenceBundlePath(evidencePath: string): boolean {
  const normalized = evidencePath.split(path.sep).join("/");
  return normalized.includes("/evidence/prototype-loop-v1/") && normalized.endsWith(".json");
}

function repoRootFromEvidencePath(evidencePath: string): string {
  return path.resolve(path.dirname(evidencePath), "..", "..");
}
