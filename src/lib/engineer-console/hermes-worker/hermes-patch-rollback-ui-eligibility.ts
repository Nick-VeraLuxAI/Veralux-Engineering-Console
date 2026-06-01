import type { HermesWorkerEvidenceSummary } from "./hermes-evidence-types";

export type HermesPatchApplicationUiState =
  HermesWorkerEvidenceSummary["patchApplication"];

export function canShowHermesPatchApplyControls(
  patchApplication: HermesPatchApplicationUiState | null | undefined,
  options: { patchProposalAvailable: boolean; changesApplied: boolean; hasDispatchId: boolean },
): boolean {
  return (
    options.patchProposalAvailable &&
    patchApplication?.status === "not_applied" &&
    !options.changesApplied &&
    options.hasDispatchId
  );
}

export function canShowHermesPatchRollbackControls(
  patchApplication: HermesPatchApplicationUiState | null | undefined,
): boolean {
  return (
    patchApplication?.status === "patch_applied" &&
    Boolean(patchApplication.rollbackArtifactPath)
  );
}
