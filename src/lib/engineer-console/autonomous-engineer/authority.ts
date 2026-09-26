import type { EngineeringTask } from "../types";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import type { AutonomousAuthorityEnvelope } from "./types";

export function buildAuthorityEnvelope(
  task: EngineeringTask,
  authorizedPathPrefixes: string[] = [],
): AutonomousAuthorityEnvelope {
  return {
    authorizedRepoPath: resolveTaskTargetRepoPath(task),
    registeredRepoId: task.registeredRepoId,
    authorizedPathPrefixes,
    canMutateViaWorkerPlan: true,
    canSelfApprove: false,
    canCreatePr: false,
    canMerge: false,
    canDeploy: false,
    canBypassValidation: false,
    canBypassQualityGates: false,
    canUseUnrestrictedShell: false,
    actor: "autonomous_executor",
  };
}

export type ProtectedGovernanceAction =
  | "create_pr"
  | "merge"
  | "deploy"
  | "approve_run"
  | "sign_off"
  | "bypass_validation"
  | "bypass_quality_gates";

export function assertExecutorCannotSelfAuthorize(
  envelope: AutonomousAuthorityEnvelope,
  action: ProtectedGovernanceAction,
): { allowed: false; action: ProtectedGovernanceAction; reason: string } {
  void envelope;
  const reasons: Record<ProtectedGovernanceAction, string> = {
    create_pr: "Autonomous executor cannot create a pull request.",
    merge: "Autonomous executor cannot merge.",
    deploy: "Autonomous executor cannot deploy.",
    approve_run: "Autonomous executor cannot self-approve a run.",
    sign_off: "Autonomous executor cannot complete release sign-off.",
    bypass_validation: "Autonomous executor cannot bypass worker-plan validation.",
    bypass_quality_gates: "Autonomous executor cannot bypass quality gates.",
  };
  return { allowed: false, action, reason: reasons[action] };
}

export function isPathAuthorized(
  envelope: AutonomousAuthorityEnvelope,
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (envelope.authorizedPathPrefixes.length === 0) return true;
  return envelope.authorizedPathPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix.replace(/\/$/, "")}/`),
  );
}

/** Scope review may see seeded harness files without treating them as AE mutations. */
export function isPathInReviewScope(
  envelope: AutonomousAuthorityEnvelope,
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (INVESTIGATION_DISCOVERY_FILES.has(normalized)) return true;
  return isPathAuthorized(envelope, normalized);
}

const INVESTIGATION_DISCOVERY_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.config.js",
  "next.config.ts",
  "next.config.js",
  "eslint.config.mjs",
  "eslint.config.js",
]);

/** Investigation may read root discovery files even when mutation prefixes are set. */
export function isInvestigationPathAllowed(
  envelope: AutonomousAuthorityEnvelope,
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (INVESTIGATION_DISCOVERY_FILES.has(normalized)) return true;
  return isPathAuthorized(envelope, normalized);
}
