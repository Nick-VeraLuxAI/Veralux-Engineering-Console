/**
 * Governance operating modes for Engineering Console.
 *
 * - build:   AE iterates; policy/review are observational; Continue engineering resumes AE.
 * - observe: Same as build for AE, but release panels stay visible as advisory.
 * - release: Hard human gates for approve / PR / merge / deploy (production posture).
 *
 * Env: ENGINEER_CONSOLE_GOVERNANCE_MODE=build|observe|release
 * When unset: release if ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true, else build.
 */

export type GovernanceMode = "build" | "observe" | "release";

export interface GovernanceModeConfig {
  mode: GovernanceMode;
  /** Hard release gates (merge/deploy/sign-off) fail-closed. */
  hardReleaseGates: boolean;
  /** Send back resumes AE on the same run instead of failing it. */
  continueEngineeringResumesAe: boolean;
  /** requires_review is advisory; only blocked risk stops approve. */
  policyReviewIsObservational: boolean;
  /** Post-approve guidance prefers worktree sandbox over PR/release. */
  preferSandboxAfterApprove: boolean;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseMode(raw: string | undefined): GovernanceMode | null {
  const value = raw?.trim().toLowerCase();
  if (value === "build" || value === "observe" || value === "release") return value;
  return null;
}

export function resolveGovernanceMode(env: NodeJS.ProcessEnv = process.env): GovernanceMode {
  const explicit = parseMode(env.ENGINEER_CONSOLE_GOVERNANCE_MODE);
  if (explicit) return explicit;
  if (parseBool(env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED)) return "release";
  return "build";
}

export function getGovernanceModeConfig(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceModeConfig {
  const mode = resolveGovernanceMode(env);
  const hardReleaseGates =
    mode === "release" || parseBool(env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED);

  return {
    mode,
    hardReleaseGates,
    continueEngineeringResumesAe: mode === "build" || mode === "observe",
    policyReviewIsObservational: mode === "build" || mode === "observe",
    preferSandboxAfterApprove: mode === "build" || mode === "observe",
  };
}

export function getPublicGovernanceModeConfig(
  config: GovernanceModeConfig = getGovernanceModeConfig(),
): {
  mode: GovernanceMode;
  continueEngineeringResumesAe: boolean;
  preferSandboxAfterApprove: boolean;
} {
  return {
    mode: config.mode,
    continueEngineeringResumesAe: config.continueEngineeringResumesAe,
    preferSandboxAfterApprove: config.preferSandboxAfterApprove,
  };
}

export function governanceModeDirectorCopy(mode: GovernanceMode): {
  zoneLabel: string;
  continueLabel: string;
  approveLabel: string;
  approveHint: string;
  continueHint: string;
} {
  switch (mode) {
    case "build":
      return {
        zoneLabel: "Build mode",
        continueLabel: "Continue engineering",
        approveLabel: "Accept delivery",
        approveHint:
          "Accepts this run’s output. Does not commit, PR, or deploy. Prefer Continue engineering if the code is incomplete.",
        continueHint:
          "Sends feedback to Autonomous Engineer and resumes the same run. Governance stays observational.",
      };
    case "observe":
      return {
        zoneLabel: "Observe mode",
        continueLabel: "Continue engineering",
        approveLabel: "Accept delivery",
        approveHint:
          "Records acceptance. Audit and policy stay visible; release gates stay advisory until you enable release mode.",
        continueHint: "Resumes Autonomous Engineer with your feedback on this run.",
      };
    case "release":
      return {
        zoneLabel: "Release mode",
        continueLabel: "Send back",
        approveLabel: "Approve",
        approveHint: "Marks the run ready for the PR / merge / deploy path.",
        continueHint: "Records a request-fix decision and ends this run’s engineering loop.",
      };
  }
}
