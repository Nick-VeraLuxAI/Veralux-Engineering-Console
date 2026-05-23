import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import type { WorkerPlanValidationError } from "./worker-plan-types";
import { parseValidationErrors } from "./worker-plan-manager";

function nowIso(): string {
  return new Date().toISOString();
}

export interface WorkerPlanDraftRecord {
  id: string;
  runId: string;
  provider: string;
  model: string;
  prompt: string;
  rawResponse: string;
  parsedPlanJson: string | null;
  validationStatus: "pending" | "valid" | "invalid" | "parse_failed";
  validationErrorsJson: string;
  createdAt: string;
}

interface WorkerPlanDraftRow {
  id: string;
  run_id: string;
  provider: string;
  model: string;
  prompt: string;
  raw_response: string;
  parsed_plan_json: string | null;
  validation_status: string;
  validation_errors_json: string;
  created_at: string;
}

function mapRow(row: WorkerPlanDraftRow): WorkerPlanDraftRecord {
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    rawResponse: row.raw_response,
    parsedPlanJson: row.parsed_plan_json,
    validationStatus: row.validation_status as WorkerPlanDraftRecord["validationStatus"],
    validationErrorsJson: row.validation_errors_json,
    createdAt: row.created_at,
  };
}

export interface CreateWorkerPlanDraftInput {
  runId: string;
  provider: string;
  model: string;
  prompt: string;
  rawResponse: string;
  parsedPlanJson: string | null;
  validationStatus: WorkerPlanDraftRecord["validationStatus"];
  validationErrors: WorkerPlanValidationError[];
}

export function createWorkerPlanDraft(input: CreateWorkerPlanDraftInput): WorkerPlanDraftRecord {
  const now = nowIso();
  const record: WorkerPlanDraftRecord = {
    id: uuidv4(),
    runId: input.runId,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    rawResponse: input.rawResponse,
    parsedPlanJson: input.parsedPlanJson,
    validationStatus: input.validationStatus,
    validationErrorsJson: JSON.stringify(input.validationErrors),
    createdAt: now,
  };

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_worker_plan_drafts
        (id, run_id, provider, model, prompt, raw_response, parsed_plan_json,
         validation_status, validation_errors_json, created_at)
       VALUES
        (@id, @run_id, @provider, @model, @prompt, @raw_response, @parsed_plan_json,
         @validation_status, @validation_errors_json, @created_at)`,
    )
    .run({
      id: record.id,
      run_id: record.runId,
      provider: record.provider,
      model: record.model,
      prompt: record.prompt,
      raw_response: record.rawResponse,
      parsed_plan_json: record.parsedPlanJson,
      validation_status: record.validationStatus,
      validation_errors_json: record.validationErrorsJson,
      created_at: record.createdAt,
    });

  return record;
}

export function getWorkerPlanDraftById(id: string): WorkerPlanDraftRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_worker_plan_drafts WHERE id = ?`)
    .get(id) as WorkerPlanDraftRow | undefined;
  return row ? mapRow(row) : null;
}

export function getLatestWorkerPlanDraftForRun(runId: string): WorkerPlanDraftRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_worker_plan_drafts WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as WorkerPlanDraftRow | undefined;
  return row ? mapRow(row) : null;
}

export function listWorkerPlanDraftsForRun(runId: string): WorkerPlanDraftRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_worker_plan_drafts WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as WorkerPlanDraftRow[];
  return rows.map(mapRow);
}

export function getDraftValidationErrors(
  draft: WorkerPlanDraftRecord,
): WorkerPlanValidationError[] {
  return parseValidationErrors(draft.validationErrorsJson);
}
