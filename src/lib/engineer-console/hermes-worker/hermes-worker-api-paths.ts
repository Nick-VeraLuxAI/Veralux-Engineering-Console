/** Hermes worker mutation routes (Engineering Console only). */
export function hermesWorkerApplyPatchPath(runId: string): string {
  return `/api/engineer-console/runs/${runId}/hermes-worker/apply-patch`;
}

export function hermesWorkerRollbackPatchPath(runId: string): string {
  return `/api/engineer-console/runs/${runId}/hermes-worker/rollback-patch`;
}

export function hermesWorkerQualityGatesRunPath(runId: string): string {
  return `/api/engineer-console/runs/${runId}/hermes-worker/quality-gates/run`;
}
