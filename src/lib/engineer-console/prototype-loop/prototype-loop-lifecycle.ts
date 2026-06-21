import fs from "fs/promises";
import path from "path";
import {
  runPrototypeLoopV1,
  type PrototypeLoopConsoleAssignment,
  type PrototypeLoopEvidence,
} from "./prototype-loop-v1";

export interface PrototypeLoopHandoff {
  classification?: {
    task_type?: string;
    requires_clarification?: boolean;
    clarification_questions?: string[];
    safe_default_rationale?: string[];
  };
  console_assignment?: PrototypeLoopConsoleAssignment;
  structured_build_request?: Record<string, unknown>;
  vera_request?: string;
}

export interface PrototypeLoopVeraReview {
  evidence_status?: string;
  ready_for_approval?: boolean;
  revision_request?: unknown;
  user_facing_summary?: {
    approval_question?: string;
    ready_for_approval?: boolean;
    what_was_created?: string;
    where_created?: string;
  };
}

export interface PrototypeLoopLifecycleResult {
  lifecycle_status: "PASS" | "BLOCKED";
  blocker_code: string | null;
  task_id: string | null;
  request: string;
  handoff_path: string;
  console_result_path: string;
  vera_review_path: string;
  lifecycle_result_path: string;
  evidence_path: string | null;
  workspace_path: string | null;
  console_status: string | null;
  vera_evidence_status: string | null;
  approval_question: string | null;
  approval_required: boolean;
  integration_performed: boolean;
}

export interface PrototypeLoopLifecycleOptions {
  request: string;
  repoRoot?: string;
  proofRunRoot?: string;
  createHandoff: (request: string) => Promise<PrototypeLoopHandoff>;
  reviewEvidence: (evidencePath: string) => Promise<PrototypeLoopVeraReview>;
}

export async function runPrototypeLoopLifecycleV1(
  options: PrototypeLoopLifecycleOptions,
): Promise<PrototypeLoopLifecycleResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const proofRunRoot = path.resolve(options.proofRunRoot ?? path.join(repoRoot, ".prototype-loop", "proof-runs"));
  await fs.mkdir(proofRunRoot, { recursive: true });

  const handoff = await options.createHandoff(options.request);
  const taskId = handoff.console_assignment?.task_id ?? "missing-task";
  const handoffPath = path.join(proofRunRoot, `${taskId}-phase-1b-handoff.json`);
  await writeJson(handoffPath, handoff);

  const consoleResultPath = path.join(proofRunRoot, `${taskId}-phase-1b-console-result.json`);
  const veraReviewPath = path.join(proofRunRoot, `${taskId}-phase-1b-vera-review.json`);
  const lifecycleResultPath = path.join(proofRunRoot, `${taskId}-phase-1b-lifecycle-result.json`);

  if (handoff.classification?.task_type !== "build_prototype" || !handoff.console_assignment) {
    const blocked = blockedResult({
      blockerCode: "PROTOTYPE_LOOP_HANDOFF_UNAVAILABLE",
      request: options.request,
      taskId: null,
      handoffPath,
      consoleResultPath,
      veraReviewPath,
      lifecycleResultPath,
    });
    await writeJson(lifecycleResultPath, blocked);
    return blocked;
  }

  const evidence = await runPrototypeLoopV1(handoff.console_assignment, { repoRoot });
  const consoleResult = consoleResultFromEvidence(evidence);
  await writeJson(consoleResultPath, consoleResult);

  const review = await options.reviewEvidence(evidence.evidence_path);
  await writeJson(veraReviewPath, review);

  const approvalQuestion = review.user_facing_summary?.approval_question ?? null;
  const passed =
    evidence.status === "ready_for_user_approval"
    && evidence.approval_required
    && !evidence.integration_performed
    && review.ready_for_approval === true
    && review.evidence_status === "ready_for_user_approval"
    && typeof approvalQuestion === "string"
    && approvalQuestion.includes("implement this prototype");

  const result: PrototypeLoopLifecycleResult = {
    lifecycle_status: passed ? "PASS" : "BLOCKED",
    blocker_code: passed ? null : "PROTOTYPE_LOOP_PHASE_1B_LIFECYCLE_FAILED",
    task_id: evidence.task_id,
    request: options.request,
    handoff_path: handoffPath,
    console_result_path: consoleResultPath,
    vera_review_path: veraReviewPath,
    lifecycle_result_path: lifecycleResultPath,
    evidence_path: evidence.evidence_path,
    workspace_path: evidence.workspace_path,
    console_status: evidence.status,
    vera_evidence_status: review.evidence_status ?? null,
    approval_question: approvalQuestion,
    approval_required: evidence.approval_required,
    integration_performed: evidence.integration_performed,
  };
  await writeJson(lifecycleResultPath, result);
  return result;
}

function consoleResultFromEvidence(evidence: PrototypeLoopEvidence): Record<string, unknown> {
  return {
    status: evidence.status,
    task_id: evidence.task_id,
    evidence_path: evidence.evidence_path,
    workspace_path: evidence.workspace_path,
    approval_required: evidence.approval_required,
    integration_performed: evidence.integration_performed,
  };
}

function blockedResult(input: {
  blockerCode: string;
  request: string;
  taskId: string | null;
  handoffPath: string;
  consoleResultPath: string;
  veraReviewPath: string;
  lifecycleResultPath: string;
}): PrototypeLoopLifecycleResult {
  return {
    lifecycle_status: "BLOCKED",
    blocker_code: input.blockerCode,
    task_id: input.taskId,
    request: input.request,
    handoff_path: input.handoffPath,
    console_result_path: input.consoleResultPath,
    vera_review_path: input.veraReviewPath,
    lifecycle_result_path: input.lifecycleResultPath,
    evidence_path: null,
    workspace_path: null,
    console_status: null,
    vera_evidence_status: null,
    approval_question: null,
    approval_required: false,
    integration_performed: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
