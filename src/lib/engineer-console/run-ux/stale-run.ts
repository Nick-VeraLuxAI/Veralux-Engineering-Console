export type StaleRunKind =
  | "stale_approval"
  | "stale_release_followup"
  | "stale_failed_run"
  | "stale_planning"
  | "inactive_run";

export interface StaleRunAssessment {
  isStale: boolean;
  staleKind: StaleRunKind | null;
  ageLabel: string | null;
  reason: string | null;
  suggestedAction: string | null;
}

export interface StaleRunInput {
  kind: "task" | "run" | "setup";
  status: string;
  bucket:
    | "needs_action"
    | "blocked_failed"
    | "ready_for_approval"
    | "ready_for_release"
    | "recently_completed"
    | "setup_attention";
  currentStageLabel: string;
  lastUpdatedAt: string;
  now?: string | number | Date;
}

const HOUR_MS = 60 * 60 * 1000;

function parseTime(value: string | number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (!value) return NaN;
  return Date.parse(value);
}

function formatAgeLabel(ageMs: number): string {
  const totalMinutes = Math.max(1, Math.floor(ageMs / (60 * 1000)));
  if (totalMinutes < 60) {
    return `${totalMinutes}m old`;
  }
  const totalHours = Math.floor(ageMs / HOUR_MS);
  if (totalHours < 48) {
    return `${Math.max(1, totalHours)}h old`;
  }
  const totalDays = Math.floor(ageMs / (24 * HOUR_MS));
  return `${Math.max(1, totalDays)}d old`;
}

export function evaluateStaleRun(input: StaleRunInput): StaleRunAssessment {
  if (input.kind !== "run") {
    return {
      isStale: false,
      staleKind: null,
      ageLabel: null,
      reason: null,
      suggestedAction: null,
    };
  }

  if (input.status === "completed" || input.status === "stopped" || input.bucket === "recently_completed") {
    return {
      isStale: false,
      staleKind: null,
      ageLabel: null,
      reason: null,
      suggestedAction: null,
    };
  }

  const updatedAt = parseTime(input.lastUpdatedAt);
  const now = parseTime(input.now ?? Date.now());
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now) || updatedAt <= 0 || now <= updatedAt) {
    return {
      isStale: false,
      staleKind: null,
      ageLabel: null,
      reason: null,
      suggestedAction: null,
    };
  }

  const ageMs = now - updatedAt;
  const ageLabel = formatAgeLabel(ageMs);

  if (input.status === "waiting_for_approval" && ageMs >= 24 * HOUR_MS) {
    return {
      isStale: true,
      staleKind: "stale_approval",
      ageLabel,
      reason: `No operator action has been recorded for this approval in over 24 hours.`,
      suggestedAction: "Review policy, evidence, and the approval report before taking over.",
    };
  }

  if (input.bucket === "ready_for_release" && ageMs >= 24 * HOUR_MS) {
    return {
      isStale: true,
      staleKind: "stale_release_followup",
      ageLabel,
      reason: `Release follow-up has been waiting for more than 24 hours.`,
      suggestedAction: "Open the run and review the current release blocker or next release action before continuing.",
    };
  }

  if (input.status === "failed" && ageMs >= 12 * HOUR_MS) {
    return {
      isStale: true,
      staleKind: "stale_failed_run",
      ageLabel,
      reason: `This failed run has been unresolved for over 12 hours.`,
      suggestedAction: "Review the run state, command center, and technical audit before retrying or handing off.",
    };
  }

  if (input.currentStageLabel.toLowerCase() === "worker plan" && ageMs >= 24 * HOUR_MS) {
    return {
      isStale: true,
      staleKind: "stale_planning",
      ageLabel,
      reason: `Worker-plan follow-up has been inactive for more than 24 hours.`,
      suggestedAction: "Open the run and review the worker plan, changed files, and current action before continuing.",
    };
  }

  if (ageMs >= 48 * HOUR_MS) {
    return {
      isStale: true,
      staleKind: "inactive_run",
      ageLabel,
      reason: `No recent activity has been recorded for this run in over 48 hours.`,
      suggestedAction: "Use the run page audit/history, Current Action, and Technical Audit before taking over.",
    };
  }

  return {
    isStale: false,
    staleKind: null,
    ageLabel,
    reason: null,
    suggestedAction: null,
  };
}
