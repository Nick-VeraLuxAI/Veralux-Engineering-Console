import type { AutonomousDocument, AutonomousReviewFinding } from "./types";
import { isPathAuthorized } from "./authority";

export function runAutonomousReviews(input: {
  document: AutonomousDocument;
  changedFiles: string[];
  diffSummary: string;
  qcPassed: boolean;
}): AutonomousReviewFinding[] {
  const requirements: AutonomousReviewFinding = {
    review: "requirements",
    passed: Boolean(input.document.interpretedObjective?.requirements.length),
    findings: input.document.interpretedObjective?.requirements ?? [],
    actionableDefects: input.document.interpretedObjective?.requirements.length
      ? []
      : ["Missing interpreted requirements."],
  };

  const suspicious = input.changedFiles.filter(
    (file) =>
      file.endsWith(".env") ||
      file.includes("node_modules/") ||
      file.startsWith(".git/"),
  );
  const diffQuality: AutonomousReviewFinding = {
    review: "diff_quality",
    passed: suspicious.length === 0 && input.changedFiles.length > 0,
    findings:
      input.changedFiles.length === 0
        ? ["No changed files to review."]
        : input.changedFiles.map((file) => `Changed ${file}`),
    actionableDefects:
      suspicious.length > 0
        ? suspicious.map((file) => `Protected or unsafe path in diff: ${file}`)
        : input.changedFiles.length === 0
          ? ["Delivery candidate has an empty diff."]
          : [],
  };

  const regressionRisk: AutonomousReviewFinding = {
    review: "regression_risk",
    passed: input.qcPassed,
    findings: input.qcPassed
      ? ["Allowlisted quality gates passed."]
      : ["Quality gates failed; regression risk is unresolved."],
    actionableDefects: input.qcPassed ? [] : ["Replan to address failing quality gates before disclose."],
  };

  const outOfScope = input.changedFiles.filter(
    (file) => !isPathAuthorized(input.document.authorityEnvelope, file),
  );
  const scope: AutonomousReviewFinding = {
    review: "scope",
    passed: outOfScope.length === 0,
    findings: [
      `Changed file count: ${input.changedFiles.length}`,
      input.diffSummary.slice(0, 300) || "No diff summary",
    ],
    actionableDefects: outOfScope.map((file) => `Out of authorized scope: ${file}`),
  };

  return [requirements, diffQuality, regressionRisk, scope];
}

export function reviewsHaveActionableDefects(reviews: AutonomousReviewFinding[]): boolean {
  return reviews.some((review) => review.actionableDefects.length > 0);
}
