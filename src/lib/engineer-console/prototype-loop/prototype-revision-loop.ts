import fs from "fs/promises";
import path from "path";
import {
  runPrototypeLoopV1,
  type PrototypeLoopCommandResult,
  type PrototypeLoopConsoleAssignment,
  type PrototypeLoopEvidence,
} from "./prototype-loop-v1";
import type { AcceptanceThresholdVerdict } from "./acceptance-threshold";

export type PrototypeRevisionRoundStatus =
  | "ready_for_user_approval"
  | "revision_requested"
  | "blocked"
  | "max_rounds_reached";

export interface PrototypeRevisionRequest {
  reason: string;
  requested_change: string;
  failed_gates: string[];
  blocked_gates: string[];
  unresolved_issues: string[];
}

export interface PrototypeRevisionVeraReview {
  evidence_status?: string;
  ready_for_approval?: boolean;
  revision_request?: {
    reason_for_revision?: string;
    requested_change?: string;
    failed_gates?: string[];
    blocked_gates?: string[];
    unresolved_issues?: string[];
  } | null;
  user_facing_summary?: {
    what_was_created?: string;
    where_created?: string;
    ready_for_approval?: boolean;
    approval_question?: string;
    remaining_risks?: unknown[];
  };
}

export interface PrototypeRevisionRound {
  round_number: number;
  input_spec: Record<string, unknown>;
  console_action_taken: string;
  files_changed: string[];
  commands_run: string[];
  acceptance_threshold: AcceptanceThresholdVerdict;
  evidence_path: string;
  vera_review_result: PrototypeRevisionVeraReview;
  revision_request: PrototypeRevisionRequest | null;
  status: PrototypeRevisionRoundStatus;
}

export interface PrototypeRevisionLoopResult {
  revision_loop_id: string;
  task_id: string;
  status: PrototypeRevisionRoundStatus;
  ready_for_user_approval: boolean;
  round_count: number;
  rounds: PrototypeRevisionRound[];
  final_readiness_verdict: AcceptanceThresholdVerdict["status"] | null;
  final_evidence_path: string | null;
  final_approval_question: string | null;
  approval_required: boolean;
  integration_performed: boolean;
  fallback_used: boolean;
  senior_super_used: boolean;
  blocking_failures: string[];
  max_rounds: number;
  summary: string;
  result_path: string;
}

export interface PrototypeRevisionLoopConfig {
  assignment: PrototypeLoopConsoleAssignment;
  request: string;
  repoRoot?: string;
  proofRunRoot?: string;
  maxRevisionRounds?: number;
  commandRunnerForRound?: (
    roundNumber: number,
  ) => ((cwd: string, command: string) => Promise<PrototypeLoopCommandResult>) | undefined;
  reviewEvidence: (evidencePath: string) => Promise<PrototypeRevisionVeraReview>;
}

export async function runPrototypeRevisionLoop(
  config: PrototypeRevisionLoopConfig,
): Promise<PrototypeRevisionLoopResult> {
  const repoRoot = path.resolve(config.repoRoot ?? process.cwd());
  const maxRounds = Math.max(1, config.maxRevisionRounds ?? config.assignment.loop_limits.max_revision_rounds ?? 3);
  const loopId = `prototype-revision-loop-${config.assignment.task_id}`;
  const proofRunRoot = path.resolve(config.proofRunRoot ?? path.join(repoRoot, ".prototype-loop", "phase-5-proof-runs", loopId));
  const rounds: PrototypeRevisionRound[] = [];

  await fs.mkdir(proofRunRoot, { recursive: true });

  for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
    const evidence = await runPrototypeLoopV1(config.assignment, {
      repoRoot,
      evidenceRoot: path.join(proofRunRoot, "evidence", `round-${roundNumber}`),
      commandRunner: config.commandRunnerForRound?.(roundNumber),
    });
    const review = await config.reviewEvidence(evidence.evidence_path);
    const revisionRequest = buildRevisionRequest(evidence, review);
    const roundStatus = roundStatusFromEvidence(evidence, review, revisionRequest, roundNumber, maxRounds);
    const round: PrototypeRevisionRound = {
      round_number: roundNumber,
      input_spec: {
        request: config.request,
        structured_build_request: config.assignment.structured_build_request,
        revision_request: rounds.at(-1)?.revision_request ?? null,
      },
      console_action_taken: roundNumber === 1
        ? "initial_governed_prototype_attempt"
        : "governed_revision_attempt",
      files_changed: evidence.files_created_or_changed,
      commands_run: evidence.commands_run,
      acceptance_threshold: evidence.acceptance_threshold,
      evidence_path: evidence.evidence_path,
      vera_review_result: review,
      revision_request: revisionRequest,
      status: roundStatus,
    };
    rounds.push(round);
    await writeJson(path.join(proofRunRoot, `round-${roundNumber}.json`), round);

    if (roundStatus === "ready_for_user_approval" || roundStatus === "blocked") {
      break;
    }
  }

  const lastRound = rounds.at(-1) ?? null;
  const ready = lastRound?.status === "ready_for_user_approval";
  const maxRoundsReached = !ready && lastRound?.status === "revision_requested" && rounds.length >= maxRounds;
  const status: PrototypeRevisionRoundStatus = ready
    ? "ready_for_user_approval"
    : maxRoundsReached
      ? "max_rounds_reached"
      : lastRound?.status ?? "blocked";
  const resultPath = path.join(proofRunRoot, `${loopId}-result.json`);
  const result: PrototypeRevisionLoopResult = {
    revision_loop_id: loopId,
    task_id: config.assignment.task_id,
    status,
    ready_for_user_approval: ready,
    round_count: rounds.length,
    rounds,
    final_readiness_verdict: lastRound?.acceptance_threshold.status ?? null,
    final_evidence_path: lastRound?.evidence_path ?? null,
    final_approval_question: ready
      ? lastRound?.vera_review_result.user_facing_summary?.approval_question ?? null
      : null,
    approval_required: config.assignment.approval_policy.approval_required,
    integration_performed: false,
    fallback_used: false,
    senior_super_used: false,
    blocking_failures: lastRound?.acceptance_threshold.blocking_failures ?? [],
    max_rounds: maxRounds,
    summary: ready
      ? `Revision loop reached ready_for_user_approval in ${rounds.length} round(s).`
      : `Revision loop stopped with ${status} after ${rounds.length} round(s).`,
    result_path: resultPath,
  };
  await attachRevisionLoopToFinalEvidence(result);
  await writeJson(resultPath, result);
  return result;
}

async function attachRevisionLoopToFinalEvidence(result: PrototypeRevisionLoopResult): Promise<void> {
  if (!result.final_evidence_path) return;
  try {
    const raw = await fs.readFile(result.final_evidence_path, "utf8");
    const evidence = JSON.parse(raw) as Record<string, unknown>;
    evidence.revision_loop = {
      revision_loop_id: result.revision_loop_id,
      round_count: result.round_count,
      round_history: result.rounds.map((round) => ({
        round_number: round.round_number,
        status: round.status,
        evidence_path: round.evidence_path,
        readiness_verdict: round.acceptance_threshold.status,
        failed_gates: round.acceptance_threshold.failed_gates,
        blocked_gates: round.acceptance_threshold.blocked_gates,
        revision_request: round.revision_request,
      })),
      final_readiness_verdict: result.final_readiness_verdict,
      approval_required: result.approval_required,
      integration_performed: result.integration_performed,
      fallback_used: result.fallback_used,
      senior_super_used: result.senior_super_used,
      final_approval_question: result.final_approval_question,
    };
    await writeJson(result.final_evidence_path, evidence);
  } catch {
    // The loop result still records the evidence path. Missing evidence is
    // already represented by threshold/evidence gates in the affected round.
  }
}

function roundStatusFromEvidence(
  evidence: PrototypeLoopEvidence,
  review: PrototypeRevisionVeraReview,
  revisionRequest: PrototypeRevisionRequest | null,
  roundNumber: number,
  maxRounds: number,
): PrototypeRevisionRoundStatus {
  if (evidence.acceptance_threshold.status === "blocked") return "blocked";
  if (
    evidence.acceptance_threshold.ready
    && review.ready_for_approval === true
    && review.evidence_status === "ready_for_user_approval"
  ) {
    return "ready_for_user_approval";
  }
  if (roundNumber >= maxRounds) return "max_rounds_reached";
  return revisionRequest ? "revision_requested" : "blocked";
}

function buildRevisionRequest(
  evidence: PrototypeLoopEvidence,
  review: PrototypeRevisionVeraReview,
): PrototypeRevisionRequest | null {
  if (evidence.acceptance_threshold.ready && review.ready_for_approval) return null;
  const failedGates = evidence.acceptance_threshold.failed_gates;
  const blockedGates = evidence.acceptance_threshold.blocked_gates;
  const unresolved = evidence.acceptance_threshold.unresolved_issues;
  const reviewRequest = review.revision_request;
  return {
    reason: reviewRequest?.reason_for_revision
      ?? evidence.acceptance_threshold.summary,
    requested_change: reviewRequest?.requested_change
      ?? focusedRevisionChange(failedGates, blockedGates, unresolved),
    failed_gates: reviewRequest?.failed_gates ?? failedGates,
    blocked_gates: reviewRequest?.blocked_gates ?? blockedGates,
    unresolved_issues: reviewRequest?.unresolved_issues ?? unresolved,
  };
}

function focusedRevisionChange(
  failedGates: string[],
  blockedGates: string[],
  unresolved: string[],
): string {
  const gateList = [...blockedGates, ...failedGates].join(", ") || "acceptance_threshold";
  const issue = unresolved[0] ?? "Repair the failing acceptance gates.";
  return `Revise only the isolated prototype workspace to satisfy gate(s): ${gateList}. First issue: ${issue}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
