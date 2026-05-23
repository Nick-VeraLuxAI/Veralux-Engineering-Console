import type { ReplayCheck } from "./replay-verification-types";
import {
  getEvidenceBundleForRun,
  parseEvidenceBundleJson,
} from "../evidence-bundles/evidence-bundle-manager";
import { hashEvidenceBundle } from "../evidence-bundles/hash-evidence-bundle";
import type { EvidenceBundleRecord } from "../evidence-bundles/evidence-bundle-types";

function passed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "passed", message, details };
}

function failed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "failed", message, details };
}

function warning(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "warning", message, details };
}

export function verifyEvidenceBundleHash(record: EvidenceBundleRecord): ReplayCheck {
  try {
    const bundle = parseEvidenceBundleJson(record.bundleJson);
    const recomputed = hashEvidenceBundle(bundle);
    if (recomputed !== record.bundleHash) {
      return failed("EVIDENCE_BUNDLE_HASH", "Stored evidence bundle hash does not match recomputed hash.", {
        storedPrefix: record.bundleHash.slice(0, 16),
        recomputedPrefix: recomputed.slice(0, 16),
      });
    }
    return passed("EVIDENCE_BUNDLE_HASH", "Evidence bundle hash matches canonical JSON.");
  } catch (error) {
    return failed(
      "EVIDENCE_BUNDLE_HASH",
      error instanceof Error ? error.message : "Evidence bundle hash verification failed.",
    );
  }
}

export function verifyEvidenceBundlePresence(
  runId: string,
  runStatus: string,
  hasDecisionRecords: boolean,
): ReplayCheck {
  const record = getEvidenceBundleForRun(runId);
  const requiresBundle =
    runStatus === "waiting_for_approval" ||
    runStatus === "completed" ||
    hasDecisionRecords ||
    runStatus === "failed";

  if (record) {
    return passed("EVIDENCE_BUNDLE_PRESENT", "Evidence bundle exists for run.");
  }

  if (requiresBundle) {
    return failed(
      "EVIDENCE_BUNDLE_PRESENT",
      "Run reached approval or human decision but evidence bundle is missing.",
      { runStatus },
    );
  }

  return warning(
    "EVIDENCE_BUNDLE_PRESENT",
    "Evidence bundle not yet created (run may still be in progress).",
    { runStatus },
  );
}

export function verifyEvidenceBundleChecks(
  runId: string,
  runStatus: string,
  hasDecisionRecords: boolean,
): ReplayCheck[] {
  const checks: ReplayCheck[] = [];
  checks.push(verifyEvidenceBundlePresence(runId, runStatus, hasDecisionRecords));
  const record = getEvidenceBundleForRun(runId);
  if (record) {
    checks.push(verifyEvidenceBundleHash(record));
  }
  return checks;
}
