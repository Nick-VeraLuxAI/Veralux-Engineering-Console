import { stableHash } from "./requirement-execution-manager";
import type {
  FailureCategory,
  FailureClassification,
  QualityBaselineRecord,
  RetryPolicyDecision,
  RetryStrategy,
  WorkerAssignmentContract,
} from "./requirement-execution-types";
import type { QualityGateResult } from "../types";
import type { RequirementExecutionAttempt } from "./requirement-execution-types";

const NON_RETRYABLE_FAILURES = new Set<FailureCategory>([
  "scope_violation",
  "forbidden_file_change",
  "approval_required",
]);

export function normalizeFailureText(value: string): string {
  return value
    .replace(/\/tmp\/[^\s)]+/g, "<tmp>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[^\s]+/g, "<timestamp>")
    .replace(/:\d+:\d+/g, ":<line>:<col>")
    .replace(/:\d+/g, ":<line>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export function fingerprintFailure(input: {
  category: FailureCategory;
  command?: string | null;
  exitCode?: number | null;
  text?: string | null;
}): string {
  return stableHash(
    JSON.stringify({
      category: input.category,
      command: input.command ?? null,
      exitCode: input.exitCode ?? null,
      text: normalizeFailureText(input.text ?? ""),
    }),
  );
}

export function classifyQualityGateFailure(gate: QualityGateResult): FailureClassification {
  const command = gate.command.toLowerCase();
  let category: FailureCategory = "quality_gate_failure";
  if (command.includes("typecheck")) category = "typecheck_failure";
  else if (command.includes("lint")) category = "lint_failure";
  else if (command.includes("build")) category = "build_failure";
  else if (command.includes("test")) category = "test_failure";
  const text = [gate.stdout, gate.stderr].filter(Boolean).join("\n");
  return {
    category,
    outcome: category === "quality_gate_failure" ? "quality_gates_failed" : "tests_failed",
    summary: `${gate.command} failed with exit code ${gate.exitCode}.`,
    details: {
      command: gate.command,
      exitCode: gate.exitCode,
      status: gate.status,
      excerpt: normalizeFailureText(text).slice(0, 500),
    },
    retryable: !NON_RETRYABLE_FAILURES.has(category),
    fingerprint: fingerprintFailure({
      category,
      command: gate.command,
      exitCode: gate.exitCode,
      text,
    }),
    associatedCommand: gate.command,
  };
}

export function classifyRunFailure(input: {
  runStatus: string;
  runMessage?: string | null;
  qualityGates: QualityGateResult[];
  changedFiles: string[];
}): FailureClassification | null {
  const failedGate = input.qualityGates.find((gate) => gate.status === "failed");
  if (failedGate) return classifyQualityGateFailure(failedGate);
  if (["failed", "cancelled", "timeout"].includes(input.runStatus)) {
    return {
      category: "worker_execution_failure",
      outcome: "execution_error",
      summary: input.runMessage || `Run ended with status ${input.runStatus} before producing acceptable output.`,
      details: { runStatus: input.runStatus },
      retryable: true,
      fingerprint: fingerprintFailure({
        category: "worker_execution_failure",
        text: input.runMessage ?? input.runStatus,
      }),
    };
  }
  if (input.changedFiles.length === 0 && input.qualityGates.every((gate) => gate.status === "skipped")) {
    return {
      category: "no_meaningful_change",
      outcome: "no_progress",
      summary: "Attempt produced no changed files and no executed quality gates.",
      details: { changedFiles: input.changedFiles, qualityGateCount: input.qualityGates.length },
      retryable: true,
      fingerprint: fingerprintFailure({
        category: "no_meaningful_change",
        text: "no-changed-files-skipped-gates",
      }),
    };
  }
  return null;
}

export function validateWorkerAssignment(assignment: WorkerAssignmentContract): string[] {
  const errors: string[] = [];
  if (!assignment.project_id) errors.push("project_id is required.");
  if (!assignment.requirement_id) errors.push("requirement_id is required.");
  if (!assignment.task_id) errors.push("task_id is required.");
  if (!assignment.attempt_id) errors.push("attempt_id is required.");
  if (assignment.acceptance_criteria.length === 0) {
    errors.push("at least one acceptance criterion is required.");
  }
  if (assignment.self_verification_allowed !== false) {
    errors.push("implementation worker cannot self-verify.");
  }
  if (assignment.execution_limits.max_runtime_seconds > 3600) {
    errors.push("max_runtime_seconds exceeds policy limit.");
  }
  if (assignment.execution_limits.max_tool_calls > 100) {
    errors.push("max_tool_calls exceeds policy limit.");
  }
  if (assignment.execution_limits.max_repair_cycles > 3) {
    errors.push("max_repair_cycles exceeds policy limit.");
  }
  if (assignment.forbidden_paths.some((entry) => assignment.allowed_paths.includes(entry))) {
    errors.push("forbidden path cannot also be allowed.");
  }
  return errors;
}

export function parseBaselineFingerprints(baseline: QualityBaselineRecord | null): Set<string> {
  if (!baseline) return new Set();
  try {
    const parsed = JSON.parse(baseline.baselineJson) as { failures?: Array<{ fingerprint: string }> };
    return new Set((parsed.failures ?? []).map((failure) => failure.fingerprint));
  } catch {
    return new Set();
  }
}

export function compareFailuresToBaseline(input: {
  baseline: QualityBaselineRecord | null;
  currentFailures: FailureClassification[];
}): {
  status: "passed" | "new_failure" | "worsened_failure" | "no_baseline";
  comparison: Record<string, unknown>;
  newFailures: string[];
  worsenedFailures: string[];
  repairedFailures: string[];
} {
  if (!input.baseline) {
    return {
      status: input.currentFailures.length === 0 ? "passed" : "no_baseline",
      comparison: { baseline: null, currentFailureCount: input.currentFailures.length },
      newFailures: input.currentFailures.map((failure) => failure.fingerprint),
      worsenedFailures: [],
      repairedFailures: [],
    };
  }
  const baselineFingerprints = parseBaselineFingerprints(input.baseline);
  const currentFingerprints = new Set(input.currentFailures.map((failure) => failure.fingerprint));
  const newFailures = [...currentFingerprints].filter((fingerprint) => !baselineFingerprints.has(fingerprint));
  const repairedFailures = [...baselineFingerprints].filter(
    (fingerprint) => !currentFingerprints.has(fingerprint),
  );
  return {
    status: newFailures.length > 0 ? "new_failure" : "passed",
    comparison: {
      baselineId: input.baseline.id,
      baselineFailureCount: baselineFingerprints.size,
      currentFailureCount: currentFingerprints.size,
    },
    newFailures,
    worsenedFailures: [],
    repairedFailures,
  };
}

export function chooseRetryPolicy(input: {
  attempts: RequirementExecutionAttempt[];
  latestFailure: FailureClassification;
  maxAttempts: number;
  modelProvider: string;
  modelName: string;
}): RetryPolicyDecision {
  const sameFingerprintCount = input.attempts.filter(
    (attempt) => attempt.failureFingerprint === input.latestFailure.fingerprint,
  ).length;
  if (!input.latestFailure.retryable || input.attempts.length >= input.maxAttempts) {
    return {
      action: "block",
      nextStrategy: "human_escalation",
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      reason: "Failure is not retryable or maximum attempts were reached.",
    };
  }
  if (sameFingerprintCount >= 2) {
    const escalationModel =
      input.modelProvider === "vera"
        ? process.env.VERA_ESCALATION_MODEL?.trim() || "ESCALATION_MODEL_UNAVAILABLE"
        : `${input.modelName}:senior`;
    return {
      action: "escalate_model",
      nextStrategy: "senior_model_review",
      modelProvider: input.modelProvider,
      modelName: escalationModel,
      reason:
        input.modelProvider === "vera" && escalationModel === "ESCALATION_MODEL_UNAVAILABLE"
          ? "Repeated identical failure fingerprint requires senior model escalation, but VERA_ESCALATION_MODEL is not configured."
          : "Repeated identical failure fingerprint requires model escalation.",
    };
  }
  const strategyByCategory: Partial<Record<FailureCategory, RetryStrategy>> = {
    test_failure: "repair_from_test_failure",
    typecheck_failure: "repair_from_build_failure",
    build_failure: "repair_from_build_failure",
    lint_failure: "narrow_scope_diagnostic",
    no_meaningful_change: "reinspect_repository",
  };
  return {
    action: input.attempts.length === 1 ? "retry" : "change_strategy",
    nextStrategy: strategyByCategory[input.latestFailure.category] ?? "alternative_implementation",
    modelProvider: input.modelProvider,
    modelName: input.modelName,
    reason: "Failure is retryable within bounded policy.",
  };
}
