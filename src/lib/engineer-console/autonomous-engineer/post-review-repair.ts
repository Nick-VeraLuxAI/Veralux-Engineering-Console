/**
 * POST_REVIEW_REPAIR — bounded repair budget after QC PASS when material review defects remain.
 * Does not raise primary semantic max_iterations. Derived from observed ledger need (fb5eab66: 1).
 */
import type { AutonomousBudgetConfig, AutonomousBudgetUsage } from "./types";

export type PostReviewFindingStatus = "NEW" | "DUPLICATE" | "RESOLVED" | "REGRESSION";

export interface ReviewFindingRecord {
  findingId: string;
  summary: string;
  status: PostReviewFindingStatus;
  firstSeenIteration: number;
  lastSeenIteration: number;
  repairAttempts: number;
}

/** Small bounded budget: enough for one targeted repair + one regression check. */
export const DEFAULT_MAX_POST_REVIEW_REPAIRS = 4;

export function resolveMaxPostReviewRepairs(budget: AutonomousBudgetConfig): number {
  if (typeof budget.max_post_review_repairs === "number" && budget.max_post_review_repairs > 0) {
    return budget.max_post_review_repairs;
  }
  return DEFAULT_MAX_POST_REVIEW_REPAIRS;
}

export function wouldExceedPostReviewRepairs(
  budget: AutonomousBudgetConfig,
  usage: AutonomousBudgetUsage,
  increment = 1,
): boolean {
  return (usage.postReviewRepairs ?? 0) + increment > resolveMaxPostReviewRepairs(budget);
}

/** Stable finding id from normalized defect text (ping-pong prevention). */
export function findingIdFromSummary(summary: string): string {
  const normalized = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `rf-${(hash >>> 0).toString(16)}`;
}

/**
 * Update finding ledger across post-QC review passes.
 * - NEW: first sighting
 * - DUPLICATE: same finding while still open (no successful clear)
 * - RESOLVED: previously open finding absent this pass
 * - REGRESSION: previously RESOLVED finding reappears
 */
export function trackPostReviewFindings(input: {
  ledger: ReviewFindingRecord[];
  actionableDefects: string[];
  iteration: number;
}): {
  ledger: ReviewFindingRecord[];
  openMaterial: string[];
  newIds: string[];
  duplicateIds: string[];
  regressionIds: string[];
  resolvedIds: string[];
} {
  const seenIds = new Set<string>();
  const byId = new Map(input.ledger.map((row) => [row.findingId, { ...row }]));
  const newIds: string[] = [];
  const duplicateIds: string[] = [];
  const regressionIds: string[] = [];
  const openMaterial: string[] = [];

  for (const summary of input.actionableDefects) {
    const findingId = findingIdFromSummary(summary);
    seenIds.add(findingId);
    openMaterial.push(summary);
    const existing = byId.get(findingId);
    if (!existing) {
      byId.set(findingId, {
        findingId,
        summary,
        status: "NEW",
        firstSeenIteration: input.iteration,
        lastSeenIteration: input.iteration,
        repairAttempts: 0,
      });
      newIds.push(findingId);
      continue;
    }
    existing.lastSeenIteration = input.iteration;
    existing.summary = summary;
    if (existing.status === "RESOLVED") {
      existing.status = "REGRESSION";
      regressionIds.push(findingId);
    } else {
      existing.status = "DUPLICATE";
      duplicateIds.push(findingId);
    }
    byId.set(findingId, existing);
  }

  const resolvedIds: string[] = [];
  for (const [id, row] of byId) {
    if (!seenIds.has(id) && row.status !== "RESOLVED") {
      row.status = "RESOLVED";
      resolvedIds.push(id);
      byId.set(id, row);
    }
  }

  return {
    ledger: [...byId.values()],
    openMaterial,
    newIds,
    duplicateIds,
    regressionIds,
    resolvedIds,
  };
}

/** Mark open findings as having received a repair attempt (anti ping-pong accounting). */
export function markFindingsRepairAttempted(
  ledger: ReviewFindingRecord[],
  summaries: string[],
): ReviewFindingRecord[] {
  const ids = new Set(summaries.map(findingIdFromSummary));
  return ledger.map((row) =>
    ids.has(row.findingId) && row.status !== "RESOLVED"
      ? { ...row, repairAttempts: row.repairAttempts + 1 }
      : row,
  );
}

/**
 * Stable acceptance: after at least one repair attempt, DUPLICATE-only open set that is
 * still "material" by keyword but already attempted → treat as stuck only via budget, not
 * infinite reopen. Callers still gate on openMaterial length + budget.
 */
export function postReviewPingPongStuck(ledger: ReviewFindingRecord[]): boolean {
  const open = ledger.filter((row) => row.status === "DUPLICATE" || row.status === "REGRESSION");
  if (open.length === 0) return false;
  return open.every((row) => row.repairAttempts >= 1);
}
