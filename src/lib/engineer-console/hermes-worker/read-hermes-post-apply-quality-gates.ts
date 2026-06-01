import path from "path";
import {
  getLatestHermesDispatchForRun,
  parseHermesRunPacketJson,
} from "./hermes-dispatch-manager";
import { listHermesQualityGateRunsForRun } from "./hermes-quality-gate-run-manager";
import { listAvailableHermesQualityGateIdsForPacket } from "./validate-hermes-quality-gates-for-run";
import type { HermesWorkerEvidenceSummary } from "./hermes-evidence-types";

export type HermesPostApplyQualityGatesSummary =
  HermesWorkerEvidenceSummary["postApplyQualityGates"];

export function emptyHermesPostApplyQualityGatesSummary(): HermesPostApplyQualityGatesSummary {
  return {
    status: "not_run",
    lastRunAt: null,
    overallStatus: null,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastBatchId: null,
    summaryArtifactPath: null,
    availableGateIds: [],
    results: [],
    notSignOff: true,
  };
}

export function buildHermesPostApplyQualityGatesSummary(
  runId: string,
): HermesPostApplyQualityGatesSummary {
  const dispatch = getLatestHermesDispatchForRun(runId);
  const availableGateIds = dispatch
    ? listAvailableHermesQualityGateIdsForPacket(parseHermesRunPacketJson(dispatch.packetJson))
    : [];

  const runs = listHermesQualityGateRunsForRun(runId);
  if (runs.length === 0) {
    return {
      status: "not_run",
      lastRunAt: null,
      overallStatus: null,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      lastBatchId: null,
      summaryArtifactPath: null,
      availableGateIds,
      results: [],
      notSignOff: true,
    };
  }

  const lastRunAt = runs[0]?.finishedAt ?? null;
  const lastBatchId = runs[0]?.batchId ?? null;
  const batchRuns = lastBatchId
    ? runs.filter((r) => r.batchId === lastBatchId)
    : runs.slice(0, 4);

  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const row of batchRuns) {
    if (row.status === "passed") passedCount += 1;
    else if (row.status === "failed") failedCount += 1;
    else skippedCount += 1;
  }

  const ran = batchRuns.filter((r) => r.status !== "skipped");
  let overallStatus: "passed" | "failed" | "partial" | null = null;
  if (ran.length > 0) {
    if (ran.every((r) => r.status === "passed")) overallStatus = "passed";
    else if (ran.every((r) => r.status === "failed")) overallStatus = "failed";
    else overallStatus = "partial";
  } else if (batchRuns.length > 0) {
    overallStatus = "partial";
  }

  const summaryArtifactPath =
    lastBatchId && batchRuns[0]
      ? path.join(
          path.dirname(path.dirname(batchRuns[0].resultArtifactPath)),
          `batch-${lastBatchId}-summary.json`,
        )
      : null;

  return {
    status: "completed",
    lastRunAt,
    overallStatus,
    passedCount,
    failedCount,
    skippedCount,
    lastBatchId,
    summaryArtifactPath,
    availableGateIds,
    results: batchRuns.map((row) => ({
      gateId: row.gateId,
      command: row.command,
      status: row.status,
      exitCode: row.exitCode,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      artifactPath: row.resultArtifactPath,
      stdoutArtifactPath: row.stdoutArtifactPath,
      stderrArtifactPath: row.stderrArtifactPath,
      timedOut: row.timedOut,
    })),
    notSignOff: true,
  };
}
