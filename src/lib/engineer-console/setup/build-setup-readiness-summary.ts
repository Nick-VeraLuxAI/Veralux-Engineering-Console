import { DEFAULT_AUDIT_CHAIN_SCOPE } from "@/lib/engineer-console/governance/audit-ledger/audit-ledger-types";
import { getLatestCompatibilityAnalysisRun } from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { listCodeIndexRuns } from "@/lib/engineer-console/repo-intelligence/code-index/code-index-manager";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import { getReleaseGateConfig } from "@/lib/engineer-console/release/release-gates/release-gate-config";
import { getAuthConfig } from "@/lib/engineer-console/security/auth-config";
import {
  buildSetupReadinessSummary,
  buildSmokeRepoExamplePath,
  buildStagingTaskPreset,
  shouldShowStagingSetupHelper,
  type SetupReadinessSummary,
  type StagingTaskPreset,
} from "./setup-ux";

export interface DashboardSetupSummary {
  readiness: SetupReadinessSummary;
  showStagingHelper: boolean;
  smokeRepoExamplePath: string;
  stagingTaskPreset: StagingTaskPreset;
  repoRoots: string[];
}

function parseBackupAlertMode(value: string | undefined): "none" | "webhook" {
  const normalized = value?.trim().toLowerCase();
  return normalized === "webhook" ? "webhook" : "none";
}

function parseRepoRoots(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function getPublicSetupEnvironmentSummary(env: NodeJS.ProcessEnv = process.env) {
  const authConfig = getAuthConfig(env);
  const releaseGateConfig = getReleaseGateConfig(env);
  const repoRoots = parseRepoRoots(env.ENGINEER_CONSOLE_REPO_ROOTS);
  const auditChainScope = env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE?.trim() || DEFAULT_AUDIT_CHAIN_SCOPE;

  return {
    authEnabled: authConfig.authEnabled,
    trustedLocalDev: authConfig.trustedLocalDev,
    releaseGatesEnabled: releaseGateConfig.hardGatesEnabled,
    auditChainScope,
    auditChainUsesDefault: auditChainScope === DEFAULT_AUDIT_CHAIN_SCOPE,
    repoRoots,
    backupAlertMode: parseBackupAlertMode(env.ENGINEER_CONSOLE_BACKUP_ALERT_MODE),
    nodeEnv: env.NODE_ENV?.trim().toLowerCase() ?? "development",
  };
}

export function buildDashboardSetupSummary(
  env: NodeJS.ProcessEnv = process.env,
): DashboardSetupSummary {
  const publicEnv = getPublicSetupEnvironmentSummary(env);
  const repos = listRegisteredRepos();
  const latestCompatibilityRun = getLatestCompatibilityAnalysisRun();

  const codeIndexedRepoCount = repos.filter((repo) => {
    const latest = listCodeIndexRuns(repo.id, 1)[0] ?? null;
    return Boolean(
      latest &&
        latest.status === "completed" &&
        (latest.symbolCount > 0 || latest.chunkCount > 0),
    );
  }).length;

  const readiness = buildSetupReadinessSummary({
    authEnabled: publicEnv.authEnabled,
    trustedLocalDev: publicEnv.trustedLocalDev,
    releaseGatesEnabled: publicEnv.releaseGatesEnabled,
    auditChainScope: publicEnv.auditChainScope,
    auditChainUsesDefault: publicEnv.auditChainUsesDefault,
    repoRoots: publicEnv.repoRoots,
    backupAlertMode: publicEnv.backupAlertMode,
    registeredRepoCount: repos.length,
    verifiedRepoCount: repos.filter((repo) => repo.verificationStatus === "ok").length,
    fileIndexedRepoCount: repos.filter((repo) => repo.fileCount > 0).length,
    codeIndexedRepoCount,
    compatibilityStatus:
      latestCompatibilityRun?.status === "completed"
        ? "completed"
        : latestCompatibilityRun?.status === "failed"
          ? "failed"
          : "missing",
  });

  return {
    readiness,
    showStagingHelper: shouldShowStagingSetupHelper({
      auditChainScope: publicEnv.auditChainScope,
      nodeEnv: publicEnv.nodeEnv,
      trustedLocalDev: publicEnv.trustedLocalDev,
    }),
    smokeRepoExamplePath: buildSmokeRepoExamplePath(publicEnv.repoRoots),
    stagingTaskPreset: buildStagingTaskPreset(),
    repoRoots: publicEnv.repoRoots,
  };
}
