import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import {
  AUTONOMOUS_ENGINEER_MODE,
  AUTONOMOUS_STATE_VERSION,
  type AutonomousDocument,
  type AutonomousFailureClass,
  type AutonomousRunStateRecord,
  type AutonomousState,
  type DeliveryCandidateStatus,
} from "./types";
import { assertTransition } from "./state-machine";
import { emptyBudgetUsage } from "./budget";
import { resolveAutonomousBudgets } from "./policy-budgets";
import { buildAuthorityEnvelope } from "./authority";
import type { EngineeringTask } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

interface AutonomousStateRow {
  id: string;
  run_id: string;
  version: number;
  mode: string;
  current_state: string;
  iteration_number: number;
  failure_class: string | null;
  delivery_candidate_status: string | null;
  state_json: string;
  created_at: string;
  updated_at: string;
}

function parseDocument(json: string): AutonomousDocument {
  return JSON.parse(json) as AutonomousDocument;
}

function mapRow(row: AutonomousStateRow): AutonomousRunStateRecord {
  return {
    id: row.id,
    runId: row.run_id,
    version: row.version,
    mode: row.mode,
    currentState: row.current_state as AutonomousState,
    iterationNumber: row.iteration_number,
    failureClass: (row.failure_class as AutonomousFailureClass | null) ?? null,
    deliveryCandidateStatus:
      (row.delivery_candidate_status as DeliveryCandidateStatus | null) ?? null,
    document: parseDocument(row.state_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isAutonomousRun(runId: string): boolean {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT id FROM engineer_autonomous_run_states WHERE run_id = ?`)
    .get(runId) as { id: string } | undefined;
  return Boolean(row);
}

export function getAutonomousState(runId: string): AutonomousRunStateRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_autonomous_run_states WHERE run_id = ?`)
    .get(runId) as AutonomousStateRow | undefined;
  return row ? mapRow(row) : null;
}

export interface CreateAutonomousStateInput {
  runId: string;
  task: EngineeringTask;
  objective: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  authorizedPathPrefixes?: string[];
}

export function createAutonomousState(input: CreateAutonomousStateInput): AutonomousRunStateRecord {
  const existing = getAutonomousState(input.runId);
  if (existing) return existing;

  const now = nowIso();
  const envelope = buildAuthorityEnvelope(input.task, input.authorizedPathPrefixes ?? []);
  const document: AutonomousDocument = {
    version: AUTONOMOUS_STATE_VERSION,
    mode: AUTONOMOUS_ENGINEER_MODE,
    originalObjective: input.objective,
    interpretedObjective: null,
    requirements: [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    constraints: input.constraints ?? [],
    authorizedRepoPath: envelope.authorizedRepoPath,
    authorizedPathPrefixes: envelope.authorizedPathPrefixes,
    authorityEnvelope: envelope,
    currentState: "created",
    iterationNumber: 0,
    budget: resolveAutonomousBudgets(),
    usage: emptyBudgetUsage(),
    strategy: null,
    observations: [],
    assumptions: [],
    decisions: [],
    priorAttempts: [],
    failedHypotheses: [],
    currentPlanId: null,
    previousPlanId: null,
    qcObservations: [],
    qcBaseline: null,
    qcDelta: null,
    workerModel: null,
    unresolvedDefects: [],
    openRisks: [],
    clarification: null,
    escalationReason: null,
    failureClass: null,
    completionEvaluation: null,
    deliveryCandidateStatus: "not_ready",
    reviews: [],
    diagnosis: null,
    failureSignatureHistory: [],
    worktreeId: null,
    startedAt: now,
    updatedAt: now,
    pausedAt: null,
    directorAbortReason: null,
  };

  const record: AutonomousRunStateRecord = {
    id: uuidv4(),
    runId: input.runId,
    version: AUTONOMOUS_STATE_VERSION,
    mode: AUTONOMOUS_ENGINEER_MODE,
    currentState: "created",
    iterationNumber: 0,
    failureClass: null,
    deliveryCandidateStatus: "not_ready",
    document,
    createdAt: now,
    updatedAt: now,
  };

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_autonomous_run_states
        (id, run_id, version, mode, current_state, iteration_number, failure_class,
         delivery_candidate_status, state_json, created_at, updated_at)
       VALUES
        (@id, @run_id, @version, @mode, @current_state, @iteration_number, @failure_class,
         @delivery_candidate_status, @state_json, @created_at, @updated_at)`,
    )
    .run({
      id: record.id,
      run_id: record.runId,
      version: record.version,
      mode: record.mode,
      current_state: record.currentState,
      iteration_number: record.iterationNumber,
      failure_class: record.failureClass,
      delivery_candidate_status: record.deliveryCandidateStatus,
      state_json: JSON.stringify(document),
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });

  return record;
}

export function persistAutonomousDocument(
  runId: string,
  document: AutonomousDocument,
): AutonomousRunStateRecord {
  const existing = getAutonomousState(runId);
  if (!existing) {
    throw new Error(`Autonomous state not found for run ${runId}`);
  }
  assertTransition(existing.currentState, document.currentState);
  const now = nowIso();
  const next: AutonomousDocument = {
    ...document,
    seniorReview:
      document.seniorReview !== undefined
        ? document.seniorReview
        : existing.document.seniorReview,
    updatedAt: now,
  };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_autonomous_run_states SET
        current_state = @current_state,
        iteration_number = @iteration_number,
        failure_class = @failure_class,
        delivery_candidate_status = @delivery_candidate_status,
        state_json = @state_json,
        updated_at = @updated_at
       WHERE run_id = @run_id`,
    )
    .run({
      run_id: runId,
      current_state: next.currentState,
      iteration_number: next.iterationNumber,
      failure_class: next.failureClass,
      delivery_candidate_status: next.deliveryCandidateStatus,
      state_json: JSON.stringify(next),
      updated_at: now,
    });
  const updated = getAutonomousState(runId);
  if (!updated) {
    throw new Error(`Autonomous state missing after persist for run ${runId}`);
  }
  return updated;
}

export function transitionAutonomousState(
  runId: string,
  nextState: AutonomousState,
  patch: Partial<AutonomousDocument> = {},
): AutonomousRunStateRecord {
  const existing = getAutonomousState(runId);
  if (!existing) {
    throw new Error(`Autonomous state not found for run ${runId}`);
  }
  const document: AutonomousDocument = {
    ...existing.document,
    ...patch,
    currentState: nextState,
    updatedAt: nowIso(),
  };
  return persistAutonomousDocument(runId, document);
}

/** Merge a document patch without changing AE state unless the patch says so. */
export function patchAutonomousDocument(
  runId: string,
  patch: Partial<AutonomousDocument>,
): AutonomousRunStateRecord {
  const existing = getAutonomousState(runId);
  if (!existing) {
    throw new Error(`Autonomous state not found for run ${runId}`);
  }
  const document: AutonomousDocument = {
    ...existing.document,
    ...patch,
    currentState: patch.currentState ?? existing.document.currentState,
    updatedAt: nowIso(),
  };
  return persistAutonomousDocument(runId, document);
}
