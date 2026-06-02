import fs from "fs";
import {
  getHealthCheckProfileByName,
  listHealthCheckProfiles,
} from "../../release/deployment-health-check/health-profile-config";
import {
  executeHttpHealthCheck,
  setHealthCheckFetchForTests,
} from "../../release/deployment-health-check/execute-http-health-check";
import type { HealthCheckProfileConfig } from "../../release/deployment-health-check/deployment-health-check-types";
import { ENGINEERING_DEPLOYMENT_PACKET_SCHEMA } from "./deployment-packet-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import { ProductionReadinessError } from "./validate-production-readiness-for-run";

export { setHealthCheckFetchForTests };

const FORBIDDEN_HOST_SUBSTRINGS = ["production", "prod."] as const;

export function assertStagingOnlyHealthProfile(profile: HealthCheckProfileConfig): void {
  if (profile.environmentName !== "staging") {
    throw new ProductionReadinessError(
      "Only staging health check profiles are allowed",
      "UNSAFE_HEALTH_CHECK_TARGET",
    );
  }
  let hostname = "";
  try {
    hostname = new URL(profile.url).hostname.toLowerCase();
  } catch {
    throw new ProductionReadinessError("Invalid staging health check URL", "UNSAFE_HEALTH_CHECK_TARGET");
  }
  for (const segment of FORBIDDEN_HOST_SUBSTRINGS) {
    if (hostname.includes(segment)) {
      throw new ProductionReadinessError(
        "Production health check targets are forbidden",
        "UNSAFE_HEALTH_CHECK_TARGET",
      );
    }
  }
}

export function resolveGovernedStagingHealthProfile(): HealthCheckProfileConfig | null {
  const explicitName = process.env.ENGINEER_CONSOLE_GOVERNED_STAGING_HEALTH_PROFILE?.trim();
  if (explicitName) {
    const profile = getHealthCheckProfileByName(explicitName);
    if (!profile || !profile.allowed || profile.type !== "http") {
      return null;
    }
    assertStagingOnlyHealthProfile(profile);
    return profile;
  }

  const stagingProfiles = listHealthCheckProfiles().filter(
    (profile) => profile.allowed && profile.type === "http" && profile.environmentName === "staging",
  );
  if (stagingProfiles.length === 0) {
    return null;
  }

  const profile = stagingProfiles[0]!;
  assertStagingOnlyHealthProfile(profile);
  return profile;
}

export interface GovernedStagingVerificationSummary {
  stagingDeploymentEvidence: {
    schema: string;
    exitCode: number;
    targetEnvironment: string;
    mergeCommitSha: string | null;
  };
  deploymentPacketEvidence: {
    schema: string;
    targetEnvironment: string;
    notDeployed: boolean;
  };
  automatedHealthCheck: {
    status: "unavailable" | "passed" | "failed" | "skipped";
    profileName: string | null;
    responseStatus: number | null;
    responseTimeMs: number | null;
    errorMessage: string | null;
  };
}

export async function buildGovernedStagingVerificationSummary(input: {
  stagingDeploymentEvidencePath: string;
  deploymentPacketPath: string;
}): Promise<GovernedStagingVerificationSummary> {
  const stagingDeploymentEvidence = JSON.parse(
    fs.readFileSync(input.stagingDeploymentEvidencePath, "utf8"),
  ) as {
    schema?: string;
    exitCode?: number;
    targetEnvironment?: string;
    mergeCommitSha?: string | null;
  };

  if (stagingDeploymentEvidence.schema !== ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA) {
    throw new ProductionReadinessError(
      "Invalid staging deployment evidence schema",
      "INVALID_STAGING_DEPLOYMENT_EVIDENCE",
    );
  }

  const deploymentPacketEvidence = JSON.parse(
    fs.readFileSync(input.deploymentPacketPath, "utf8"),
  ) as {
    schema?: string;
    targetEnvironment?: string;
    notDeployed?: boolean;
  };

  if (deploymentPacketEvidence.schema !== ENGINEERING_DEPLOYMENT_PACKET_SCHEMA) {
    throw new ProductionReadinessError(
      "Invalid deployment packet evidence schema",
      "INVALID_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }

  if (deploymentPacketEvidence.targetEnvironment !== "staging") {
    throw new ProductionReadinessError(
      "Deployment packet target is not staging",
      "PRODUCTION_DEPLOY_FORBIDDEN",
    );
  }

  const profile = resolveGovernedStagingHealthProfile();
  if (!profile) {
    return {
      stagingDeploymentEvidence: {
        schema: stagingDeploymentEvidence.schema,
        exitCode: stagingDeploymentEvidence.exitCode ?? -1,
        targetEnvironment: stagingDeploymentEvidence.targetEnvironment ?? "staging",
        mergeCommitSha: stagingDeploymentEvidence.mergeCommitSha ?? null,
      },
      deploymentPacketEvidence: {
        schema: deploymentPacketEvidence.schema,
        targetEnvironment: deploymentPacketEvidence.targetEnvironment ?? "staging",
        notDeployed: deploymentPacketEvidence.notDeployed !== false,
      },
      automatedHealthCheck: {
        status: "unavailable",
        profileName: null,
        responseStatus: null,
        responseTimeMs: null,
        errorMessage: "No configured staging health check profile",
      },
    };
  }

  const healthResult = await executeHttpHealthCheck(profile);
  const passed =
    !healthResult.timedOut &&
    !healthResult.errorMessage &&
    healthResult.responseStatus === profile.expectedStatus;

  return {
    stagingDeploymentEvidence: {
      schema: stagingDeploymentEvidence.schema,
      exitCode: stagingDeploymentEvidence.exitCode ?? -1,
      targetEnvironment: stagingDeploymentEvidence.targetEnvironment ?? "staging",
      mergeCommitSha: stagingDeploymentEvidence.mergeCommitSha ?? null,
    },
    deploymentPacketEvidence: {
      schema: deploymentPacketEvidence.schema,
      targetEnvironment: deploymentPacketEvidence.targetEnvironment ?? "staging",
      notDeployed: deploymentPacketEvidence.notDeployed !== false,
    },
    automatedHealthCheck: {
      status: passed ? "passed" : "failed",
      profileName: profile.name,
      responseStatus: healthResult.responseStatus,
      responseTimeMs: healthResult.responseTimeMs,
      errorMessage: healthResult.errorMessage,
    },
  };
}
