import type { AutonomousDocument, AutonomousReviewFinding, CompletionEvaluation } from "./types";
import { isPathAuthorized } from "./authority";

export function evaluateCompletion(input: {
  document: AutonomousDocument;
  qcPassed: boolean;
  changedFiles: string[];
  reviews: AutonomousReviewFinding[];
}): CompletionEvaluation {
  const interpretation = input.document.interpretedObjective;
  const unmetAcceptanceCriteria: string[] = [];
  const unmetRequirements: string[] = [];

  if (!input.qcPassed) {
    unmetAcceptanceCriteria.push("Quality gates have not passed.");
  }

  const actionableReviewDefects = input.reviews.flatMap((review) => review.actionableDefects);
  const blockingDefects = input.document.unresolvedDefects
    .filter((defect) => defect.actionable && defect.severity !== "minor")
    .map((defect) => defect.summary);

  if (actionableReviewDefects.length > 0) {
    unmetAcceptanceCriteria.push("Actionable review defects remain.");
  }

  const criteria = interpretation?.acceptanceCriteria ?? input.document.acceptanceCriteria;
  for (const criterion of criteria) {
    const lower = criterion.toLowerCase();
    if (lower.includes("file") && input.changedFiles.length === 0 && input.qcPassed === false) {
      unmetAcceptanceCriteria.push(criterion);
    }
  }

  const requirements = interpretation?.requirements ?? input.document.requirements;
  if (requirements.length === 0) {
    unmetRequirements.push("Interpreted requirements are missing.");
  }

  const outOfScope = input.changedFiles.filter(
    (file) => !isPathAuthorized(input.document.authorityEnvelope, file),
  );
  const withinAuthority = outOfScope.length === 0;
  if (!withinAuthority) {
    unmetRequirements.push(`Changed files outside authority envelope: ${outOfScope.join(", ")}`);
  }

  if (input.document.authorityEnvelope.canSelfApprove) {
    unmetRequirements.push("Authority envelope must not allow executor self-approval.");
  }

  const reviewsPassed =
    input.reviews.length > 0 &&
    input.reviews.every((review) => review.passed && review.actionableDefects.length === 0);

  const complete =
    input.qcPassed &&
    withinAuthority &&
    reviewsPassed &&
    unmetAcceptanceCriteria.length === 0 &&
    unmetRequirements.length === 0 &&
    blockingDefects.length === 0 &&
    actionableReviewDefects.length === 0;

  return {
    complete,
    summary: complete
      ? "Objective-level completion: requirements, QC, reviews, and authority checks passed."
      : "Objective is not complete; remaining defects require another iteration.",
    unmetAcceptanceCriteria,
    unmetRequirements,
    defectsBlocking: [...blockingDefects, ...actionableReviewDefects],
    qcPassed: input.qcPassed,
    reviewsPassed,
    withinAuthority,
  };
}
