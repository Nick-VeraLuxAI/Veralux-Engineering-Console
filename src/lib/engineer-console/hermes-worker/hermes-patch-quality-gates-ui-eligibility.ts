import type { HermesWorkerEvidenceSummary } from "./hermes-evidence-types";

export function canShowHermesPostApplyQualityGates(
  patchApplication: HermesWorkerEvidenceSummary["patchApplication"] | null | undefined,
): boolean {
  return patchApplication?.status === "patch_applied";
}
