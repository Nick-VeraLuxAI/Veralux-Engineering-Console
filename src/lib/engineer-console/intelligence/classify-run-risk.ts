import type { DangerPoint, RunRiskClassification, RunRiskLevel, DangerPointSeverity } from "./danger-point-types";
import {
  classifyPathDomains,
  maxSeverityForDomains,
  normalizeIntelligencePath,
  summarizeChangedFileRisk,
} from "./path-risk-rules";

export interface ClassifyRunRiskInput {
  changedFiles: string[];
  dangerPoints: DangerPoint[];
  operationTypes: string[];
  createdFiles: string[];
}

const SEVERITY_ORDER: DangerPointSeverity[] = ["info", "low", "medium", "high", "critical"];
const RISK_BASE_SCORE: Record<RunRiskLevel, number> = {
  low: 22,
  medium: 56,
  high: 82,
  critical: 95,
};

function maxSeverity(
  left: DangerPointSeverity,
  right: DangerPointSeverity,
): DangerPointSeverity {
  return SEVERITY_ORDER.indexOf(right) > SEVERITY_ORDER.indexOf(left) ? right : left;
}

function maxRiskLevel(left: RunRiskLevel, right: RunRiskLevel): RunRiskLevel {
  const order: RunRiskLevel[] = ["low", "medium", "high", "critical"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

export function classifyRunRisk(input: ClassifyRunRiskInput): RunRiskClassification {
  const normalizedChangedFiles = input.changedFiles.map(normalizeIntelligencePath).filter(Boolean);
  const changedFileRiskSummary = summarizeChangedFileRisk({
    changedFiles: normalizedChangedFiles,
    createdFiles: input.createdFiles.map(normalizeIntelligencePath),
    operationTypes: input.operationTypes,
  });

  let riskLevel: RunRiskLevel = "low";
  const reasons: string[] = [];
  let highestSeverity: DangerPointSeverity = "info";

  for (const file of normalizedChangedFiles) {
    highestSeverity = maxSeverity(highestSeverity, maxSeverityForDomains(classifyPathDomains(file)));
  }
  for (const dangerPoint of input.dangerPoints) {
    highestSeverity = maxSeverity(highestSeverity, dangerPoint.severity);
  }

  if (changedFileRiskSummary.criticalRiskPaths.length > 0) {
    riskLevel = "critical";
    reasons.push("Critical domain paths were changed.");
  } else if (changedFileRiskSummary.highRiskPaths.length > 0) {
    riskLevel = "high";
    reasons.push("High-risk protected domains are in scope.");
  } else if (changedFileRiskSummary.docsOnly) {
    riskLevel = "low";
    reasons.push("All changed files are documentation-only.");
  } else if (changedFileRiskSummary.testOnly) {
    riskLevel = "low";
    reasons.push("All changed files are test-only.");
  } else if (changedFileRiskSummary.stagingOnly) {
    riskLevel = "low";
    reasons.push("The change set is staging-only.");
  } else if (changedFileRiskSummary.reversibleSimpleFileCreation) {
    riskLevel = "low";
    reasons.push("The worker plan only creates reversible new files.");
  } else if (
    (changedFileRiskSummary.domainCounts.ui ?? 0) > 0 &&
    (changedFileRiskSummary.domainCounts.api_logic ?? 0) === 0 &&
    (changedFileRiskSummary.domainCounts.app_logic ?? 0) <= (changedFileRiskSummary.domainCounts.ui ?? 0)
  ) {
    riskLevel = "medium";
    reasons.push("The change set is primarily UI-focused behavior or presentation code.");
  } else if (
    (changedFileRiskSummary.domainCounts.api_logic ?? 0) > 0 ||
    (changedFileRiskSummary.domainCounts.integration_glue ?? 0) > 0 ||
    (changedFileRiskSummary.domainCounts.app_logic ?? 0) > 0
  ) {
    riskLevel = "medium";
    reasons.push("The run changes executable application logic.");
  }

  const scopeDanger = input.dangerPoints.filter(
    (point) =>
      point.category === "intent_interpretation" ||
      point.category === "worker_plan_scope" ||
      point.category === "protected_domain" ||
      point.category === "release_governance",
  );

  if (scopeDanger.some((point) => point.severity === "critical")) {
    riskLevel = "critical";
    reasons.push("A critical protected-domain or governance danger point was detected.");
  } else if (scopeDanger.some((point) => point.severity === "high")) {
    riskLevel = maxRiskLevel(riskLevel, "high");
    reasons.push("A high-severity scope or governed-domain danger point was detected.");
  } else if (scopeDanger.some((point) => point.severity === "medium")) {
    riskLevel = maxRiskLevel(riskLevel, "medium");
    reasons.push("Scope interpretation requires human review.");
  }

  const uniqueReasons = Array.from(new Set(reasons));
  let riskScore = RISK_BASE_SCORE[riskLevel];
  riskScore += Math.min(10, Math.max(0, normalizedChangedFiles.length - 1) * 2);
  riskScore += Math.min(
    10,
    input.dangerPoints.filter(
      (point) =>
        point.category === "protected_domain" ||
        point.category === "worker_plan_scope" ||
        point.category === "intent_interpretation",
    ).length * 2,
  );
  if (changedFileRiskSummary.docsOnly || changedFileRiskSummary.testOnly || changedFileRiskSummary.stagingOnly) {
    riskScore -= 4;
  }
  riskScore = Math.max(0, Math.min(100, riskScore));

  return {
    riskLevel,
    riskScore,
    reasons: uniqueReasons,
    highestSeverity,
    changedFileRiskSummary,
  };
}
