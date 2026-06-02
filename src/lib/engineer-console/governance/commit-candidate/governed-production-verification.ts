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
import { ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA } from "./production-deployment-packet-types";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA } from "./production-deployment-types";
import { ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA } from "./production-readiness-types";
import { CompletionReadinessError } from "./validate-completion-readiness-for-run";

export { setHealthCheckFetchForTests };

const FORBIDDEN_HOST_SUBSTRINGS = ["staging", "localhost"] as const;

export function assertProductionOnlyHealthProfile(profile: HealthCheckProfileConfig): void {
  if (profile.environmentName !== "production") {
    throw new CompletionReadinessError(
      "Only production health check profiles are allowed",
      "UNSAFE_HEALTH_CHECK_TARGET",
    );
  }
  let hostname = "";
  try {
    hostname = new URL(profile.url).hostname.toLowerCase();
  } catch {
    throw new CompletionReadinessError(
      "Invalid production health check URL",
      "UNSAFE_HEALTH_CHECK_TARGET",
    );
  }
  for (const segment of FORBIDDEN_HOST_SUBSTRINGS) {
    if (hostname.includes(segment)) {
      throw new CompletionReadinessError(
        "Non-production health check targets are forbidden",
        "UNSAFE_HEALTH_CHECK_TARGET",
      );
    }
  }
}

export function resolveGovernedProductionHealthProfile(): HealthCheckProfileConfig | null {
  const explicitName = process.env.ENGINEER_CONSOLE_GOVERNED_PRODUCTION_HEALTH_PROFILE?.trim();
  if (explicitName) {
    const profile = getHealthCheckProfileByName(explicitName);
    if (!profile || !profile.allowed || profile.type !== "http") {
      return null;
    }
    assertProductionOnlyHealthProfile(profile);
    return profile;
  }

  const productionProfiles = listHealthCheckProfiles().filter(
    (profile) =>
      profile.allowed && profile.type === "http" && profile.environmentName === "production",
  );
  if (productionProfiles.length === 0) {
    return null;
  }

  const profile = productionProfiles[0]!;
  assertProductionOnlyHealthProfile(profile);
  return profile;
}

export interface GovernedProductionVerificationSummary {
  productionDeploymentEvidence: {
    schema: string;
    exitCode: number;
    targetEnvironment: string;
    mergeCommitSha: string | null;
  };
  productionDeploymentPacketEvidence: {
    schema: string;
    targetEnvironment: string;
    notProductionDeployed: boolean;
  };
  productionReadinessEvidence: {
    schema: string;
    decision: string;
  };
  automatedHealthCheck: {
    status: "unavailable" | "passed" | "failed" | "skipped";
    profileName: string | null;
    responseStatus: number | null;
    responseTimeMs: number | null;
    errorMessage: string | null;
  };
}

export async function buildGovernedProductionVerificationSummary(input: {
  productionDeploymentEvidencePath: string;
  productionDeploymentPacketPath: string;
  productionReadinessEvidencePath: string;
}): Promise<GovernedProductionVerificationSummary> {
  const productionDeploymentEvidence = JSON.parse(
    fs.readFileSync(input.productionDeploymentEvidencePath, "utf8"),
  ) as {
    schema?: string;
    exitCode?: number;
    targetEnvironment?: string;
    mergeCommitSha?: string | null;
  };

  if (productionDeploymentEvidence.schema !== ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production deployment evidence schema",
      "INVALID_PRODUCTION_DEPLOYMENT_EVIDENCE",
    );
  }

  const productionDeploymentPacketEvidence = JSON.parse(
    fs.readFileSync(input.productionDeploymentPacketPath, "utf8"),
  ) as {
    schema?: string;
    targetEnvironment?: string;
    notProductionDeployed?: boolean;
  };

  if (productionDeploymentPacketEvidence.schema !== ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production deployment packet evidence schema",
      "INVALID_PRODUCTION_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }

  if (productionDeploymentPacketEvidence.targetEnvironment !== "production") {
    throw new CompletionReadinessError(
      "Production deployment packet target is not production",
      "UNSAFE_HEALTH_CHECK_TARGET",
    );
  }

  const productionReadinessEvidence = JSON.parse(
    fs.readFileSync(input.productionReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };

  if (productionReadinessEvidence.schema !== ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production readiness evidence schema",
      "INVALID_PRODUCTION_READINESS_EVIDENCE",
    );
  }

  const profile = resolveGovernedProductionHealthProfile();
  if (!profile) {
    return {
      productionDeploymentEvidence: {
        schema: productionDeploymentEvidence.schema,
        exitCode: productionDeploymentEvidence.exitCode ?? -1,
        targetEnvironment: productionDeploymentEvidence.targetEnvironment ?? "production",
        mergeCommitSha: productionDeploymentEvidence.mergeCommitSha ?? null,
      },
      productionDeploymentPacketEvidence: {
        schema: productionDeploymentPacketEvidence.schema,
        targetEnvironment: productionDeploymentPacketEvidence.targetEnvironment ?? "production",
        notProductionDeployed: productionDeploymentPacketEvidence.notProductionDeployed !== false,
      },
      productionReadinessEvidence: {
        schema: productionReadinessEvidence.schema,
        decision: productionReadinessEvidence.decision ?? "unknown",
      },
      automatedHealthCheck: {
        status: "unavailable",
        profileName: null,
        responseStatus: null,
        responseTimeMs: null,
        errorMessage: "No configured production health check profile",
      },
    };
  }

  const healthResult = await executeHttpHealthCheck(profile);
  const passed =
    !healthResult.timedOut &&
    !healthResult.errorMessage &&
    healthResult.responseStatus === profile.expectedStatus;

  return {
    productionDeploymentEvidence: {
      schema: productionDeploymentEvidence.schema,
      exitCode: productionDeploymentEvidence.exitCode ?? -1,
      targetEnvironment: productionDeploymentEvidence.targetEnvironment ?? "production",
      mergeCommitSha: productionDeploymentEvidence.mergeCommitSha ?? null,
    },
    productionDeploymentPacketEvidence: {
      schema: productionDeploymentPacketEvidence.schema,
      targetEnvironment: productionDeploymentPacketEvidence.targetEnvironment ?? "production",
      notProductionDeployed: productionDeploymentPacketEvidence.notProductionDeployed !== false,
    },
    productionReadinessEvidence: {
      schema: productionReadinessEvidence.schema,
      decision: productionReadinessEvidence.decision ?? "unknown",
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
