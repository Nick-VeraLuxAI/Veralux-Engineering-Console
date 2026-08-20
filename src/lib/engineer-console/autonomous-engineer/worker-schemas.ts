import { parseWorkerPlanJson } from "../worker-plan/worker-plan-validation";

export const AUTONOMOUS_WORKER_ROLES = [
  "interpretation",
  "investigation",
  "planning",
  "diagnosis",
  "replan",
  "completion",
  "review",
] as const;

export type AutonomousWorkerRole = (typeof AUTONOMOUS_WORKER_ROLES)[number];

export interface WorkerSchemaResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== "string" || !(record[key] as string).trim()) {
    errors.push(`${key} must be a non-empty string`);
  }
}

function requireStringArray(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== "string")) {
    errors.push(`${key} must be an array of strings`);
  }
}

export function validateAutonomousWorkerSchema(
  role: AutonomousWorkerRole,
  parsed: Record<string, unknown> | null,
): WorkerSchemaResult {
  if (!parsed) {
    return { valid: false, errors: ["Parsed JSON object is required"] };
  }

  const errors: string[] = [];

  switch (role) {
    case "interpretation":
      requireString(parsed, "objectiveSummary", errors);
      requireStringArray(parsed, "requirements", errors);
      requireStringArray(parsed, "acceptanceCriteria", errors);
      if (parsed.assumptions !== undefined) requireStringArray(parsed, "assumptions", errors);
      if (parsed.investigationTargets !== undefined) {
        requireStringArray(parsed, "investigationTargets", errors);
      }
      break;
    case "investigation":
      requireString(parsed, "summary", errors);
      if (parsed.filesToInspect !== undefined) requireStringArray(parsed, "filesToInspect", errors);
      if (parsed.hypotheses !== undefined) requireStringArray(parsed, "hypotheses", errors);
      break;
    case "planning":
    case "replan": {
      const plan = parseWorkerPlanJson(parsed);
      errors.push(...plan.errors.map((err) => err.message));
      break;
    }
    case "diagnosis":
      requireString(parsed, "whyPreviousFailed", errors);
      requireString(parsed, "suggestedStrategy", errors);
      if (parsed.filesToInspect !== undefined) requireStringArray(parsed, "filesToInspect", errors);
      // Structured evidence-grounded fields are optional for backward compatibility.
      for (const key of [
        "observed_failure",
        "evidence_quote_or_signature",
        "affected_file_or_gate",
        "root_cause_hypothesis",
        "contradictory_evidence",
        "recommended_strategy_change",
        "avoid_repeating",
      ]) {
        if (parsed[key] !== undefined && typeof parsed[key] !== "string") {
          errors.push(`${key} must be a string when present`);
        }
      }
      if (
        parsed.confidence !== undefined &&
        parsed.confidence !== "low" &&
        parsed.confidence !== "medium" &&
        parsed.confidence !== "high"
      ) {
        errors.push("confidence must be low|medium|high when present");
      }
      break;
    case "completion":
      if (typeof parsed.complete !== "boolean") errors.push("complete must be a boolean");
      requireString(parsed, "summary", errors);
      if (parsed.unmetAcceptanceCriteria !== undefined) {
        requireStringArray(parsed, "unmetAcceptanceCriteria", errors);
      }
      break;
    case "review":
      if (typeof parsed.passed !== "boolean") errors.push("passed must be a boolean");
      if (parsed.findings !== undefined) requireStringArray(parsed, "findings", errors);
      if (parsed.actionableDefects !== undefined) {
        requireStringArray(parsed, "actionableDefects", errors);
      }
      break;
    default:
      errors.push(`Unknown worker role: ${role}`);
  }

  return { valid: errors.length === 0, errors };
}

export function isPlainWorkerObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
