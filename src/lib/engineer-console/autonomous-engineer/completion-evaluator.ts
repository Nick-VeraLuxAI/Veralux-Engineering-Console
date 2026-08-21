import fs from "fs";
import path from "path";
import type {
  AcceptanceCriterionEvidence,
  AutonomousDocument,
  AutonomousReviewFinding,
  CompletionEvaluation,
} from "./types";
import { isPathAuthorized } from "./authority";
import { listAuthorizedWorktreeFiles } from "./plan-worktree-adapter";

export type { AcceptanceCriterionEvidence };

/** Material cleanup / residue AC that must be verified against the authorized tree before ready. */
export function isMaterialCleanupCriterion(criterion: string): boolean {
  return /dead|shim|HACK|TODO|circular|self-import|duplicate|scaffolding|obsolete|unused/i.test(
    criterion,
  );
}

export function evaluateMaterialAcceptanceCriteria(input: {
  criteria: string[];
  repoPath?: string;
  authorizedPathPrefixes?: string[];
  qcPassed: boolean;
}): AcceptanceCriterionEvidence[] {
  const prefixes = input.authorizedPathPrefixes ?? ["src/"];
  const tree =
    input.repoPath && fs.existsSync(input.repoPath)
      ? listAuthorizedWorktreeFiles(input.repoPath, prefixes, 96)
      : [];
  const contents: Record<string, string> = {};
  for (const relative of tree) {
    if (!/\.(js|ts|mjs|cjs)$/.test(relative)) continue;
    try {
      contents[relative] = fs.readFileSync(path.join(input.repoPath!, relative), "utf8");
    } catch {
      // skip
    }
  }

  return input.criteria.map((criterion) => {
    if (!isMaterialCleanupCriterion(criterion)) {
      if (input.qcPassed) {
        return {
          criterion,
          status: "SATISFIED" as const,
          detail: "Non-material criterion treated as satisfied when QC passed.",
        };
      }
      return {
        criterion,
        status: "UNVERIFIED" as const,
        detail: "QC has not passed; criterion remains unverified.",
      };
    }

    const joinedSrc = Object.values(contents).join("\n");
    const deadShimPresent =
      tree.some((p) => /dead-shim/i.test(p)) || /unusedNormalizeShim/.test(joinedSrc);
    const hackTodo = /\/\/\s*(?:HACK|TODO|WORKAROUND|TEMP)\b/i.test(joinedSrc);
    const circular = Object.entries(contents).some(([file, content]) => {
      const base = path.basename(file).replace(/\.(js|ts|mjs|cjs)$/, "");
      return new RegExp(
        String.raw`from\s+['"]\.\/${base}(?:\.(?:js|ts|mjs|cjs))?['"]`,
      ).test(content);
    });
    const legacyDup = /export\s+function\s+\w+_(?:v\d+|legacy|shim)\b/.test(joinedSrc);

    const wantsDeadGone = /dead|shim|duplicate|unused|obsolete/i.test(criterion);
    const wantsHackGone = /HACK|TODO|scaffolding/i.test(criterion);
    const wantsCircularGone = /circular|self-import/i.test(criterion);

    const unsatisfied: string[] = [];
    if (wantsDeadGone && (deadShimPresent || legacyDup)) {
      unsatisfied.push(
        deadShimPresent
          ? `dead shim residue still present (${tree.filter((p) => /dead-shim/i.test(p)).join(", ") || "shim symbols"})`
          : "legacy/duplicate helper exports remain",
      );
    }
    if (wantsHackGone && hackTodo) unsatisfied.push("HACK/TODO scaffolding remains");
    if (wantsCircularGone && circular) unsatisfied.push("circular/self-import remains");

    if (unsatisfied.length > 0) {
      return {
        criterion,
        status: "UNSATISFIED" as const,
        detail: unsatisfied.join("; "),
      };
    }

    if (!input.repoPath) {
      return {
        criterion,
        status: "UNVERIFIED" as const,
        detail: "No worktree path available to verify material cleanup AC.",
      };
    }

    return {
      criterion,
      status: "SATISFIED" as const,
      detail: `Authorized tree checked (${tree.length} paths); no matching residue.`,
    };
  });
}

export function evaluateCompletion(input: {
  document: AutonomousDocument;
  qcPassed: boolean;
  changedFiles: string[];
  reviews: AutonomousReviewFinding[];
  repoPath?: string;
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

  const acEvidence = evaluateMaterialAcceptanceCriteria({
    criteria,
    repoPath: input.repoPath,
    authorizedPathPrefixes: input.document.authorizedPathPrefixes,
    qcPassed: input.qcPassed,
  });
  for (const row of acEvidence) {
    if (row.status === "UNSATISFIED") {
      unmetAcceptanceCriteria.push(`${row.criterion} [${row.status}: ${row.detail}]`);
    } else if (row.status === "UNVERIFIED" && isMaterialCleanupCriterion(row.criterion)) {
      unmetAcceptanceCriteria.push(`${row.criterion} [${row.status}: ${row.detail}]`);
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
    acceptanceEvidence: acEvidence,
  };
}
