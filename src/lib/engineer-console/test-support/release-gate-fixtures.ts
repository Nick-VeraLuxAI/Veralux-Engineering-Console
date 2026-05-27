import { getEngineerConsoleDb } from "../db/client";
import {
  getLatestReleaseChecklistForRun,
  runReleaseChecklistEvaluation,
} from "../release/release-checklist/release-checklist-manager";
import { toStorableReleaseChecklistEvaluation } from "../release/release-checklist/sanitize-release-checklist-evaluation";
import type {
  ReleaseChecklistEvaluation,
  ReleaseChecklistStatus,
} from "../release/release-checklist/release-checklist-types";
import { parseReleaseChecklistEvaluation } from "../release/release-checklist/release-checklist-manager";

/**
 * Persists a release checklist row so hard-gate deployment approval can proceed.
 * When the computed checklist is blocked, updates the persisted row to a non-blocked status for test seeding.
 */
export async function persistReleaseChecklistForHardGates(
  runId: string,
  options: { targetStatus?: ReleaseChecklistStatus } = {},
): Promise<void> {
  const targetStatus = options.targetStatus ?? "complete";
  await runReleaseChecklistEvaluation(runId, { persist: true, audit: false });

  const latest = getLatestReleaseChecklistForRun(runId);
  if (!latest) {
    throw new Error(`Expected persisted release checklist for run ${runId}`);
  }

  if (latest.status === targetStatus && latest.status !== "blocked") {
    return;
  }

  const parsed = parseReleaseChecklistEvaluation(latest);
  const adjusted: ReleaseChecklistEvaluation = {
    ...parsed,
    status: targetStatus,
    blockers: targetStatus === "blocked" ? parsed.blockers : [],
    needsAttention: targetStatus === "needs_attention" ? parsed.needsAttention : [],
    recommendedAction:
      targetStatus === "complete"
        ? "Release checklist complete for test fixture."
        : parsed.recommendedAction,
  };

  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_release_checklists
       SET status = @status, checklist_json = @checklist_json, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: latest.id,
      status: targetStatus,
      checklist_json: JSON.stringify(toStorableReleaseChecklistEvaluation(adjusted)),
      updated_at: new Date().toISOString(),
    });
}
