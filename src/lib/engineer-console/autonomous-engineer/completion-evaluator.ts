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

/** Material allow/deny window AC — reject constant stub helpers that only QC-green. */
export function isMaterialRateLimitCriterion(criterion: string): boolean {
  return /allow|deny|limit|window|quota|throttle|burst|rate|lease|attempt|slot|grant|ttl/i.test(
    criterion,
  );
}

function readAuthorizedJsContents(
  repoPath: string | undefined,
  prefixes: string[],
): { tree: string[]; contents: Record<string, string> } {
  const tree =
    repoPath && fs.existsSync(repoPath) ? listAuthorizedWorktreeFiles(repoPath, prefixes, 96) : [];
  const contents: Record<string, string> = {};
  for (const relative of tree) {
    if (!/\.(js|ts|mjs|cjs)$/.test(relative)) continue;
    try {
      contents[relative] = fs.readFileSync(path.join(repoPath!, relative), "utf8");
    } catch {
      // skip
    }
  }
  return { tree, contents };
}

export function evaluateMaterialAcceptanceCriteria(input: {
  criteria: string[];
  repoPath?: string;
  authorizedPathPrefixes?: string[];
  qcPassed: boolean;
}): AcceptanceCriterionEvidence[] {
  const prefixes = input.authorizedPathPrefixes ?? ["src/"];
  const { tree, contents } = readAuthorizedJsContents(input.repoPath, prefixes);

  return input.criteria.map((criterion) => {
    if (isMaterialRateLimitCriterion(criterion) && !isMaterialCleanupCriterion(criterion)) {
      if (!input.qcPassed) {
        return {
          criterion,
          status: "UNVERIFIED" as const,
          detail: "QC has not passed; rate-limit criterion remains unverified.",
        };
      }
      if (!input.repoPath) {
        return {
          criterion,
          status: "UNVERIFIED" as const,
          detail: "No worktree path available to verify rate-limit AC.",
        };
      }
      const prod = Object.entries(contents)
        .filter(([file]) => !/\.(test|spec)\./.test(file) && !file.includes("__tests__/"))
        .map(([, c]) => c)
        .join("\n");
      const tests = Object.entries(contents)
        .filter(([file]) => /\.(test|spec)\./.test(file) || file.includes("__tests__/"))
        .map(([, c]) => c)
        .join("\n");
      const stateful =
        (/\bnew Map\b|\bnew Set\b/.test(prod) && /\.get\s*\(|\.set\s*\(|\.has\s*\(/.test(prod)) ||
        /\bcount\s*(\+|=\s*)/.test(prod);
      const denyAsserted =
        /strictEqual\s*\([^)]*\bfalse\b|\.equal\s*\([^)]*\bfalse\b|assert\.ok\s*\(\s*!/.test(tests);
      const unsatisfied: string[] = [];
      if (/allow|deny|limit|window|quota|throttle|burst|rate/i.test(criterion) && !stateful) {
        unsatisfied.push("no stateful window/quota tracking in production sources");
      }
      if (/deny|allow|limit|window/i.test(criterion) && !denyAsserted) {
        unsatisfied.push("tests do not assert a deny/false outcome");
      }
      if (unsatisfied.length > 0) {
        return {
          criterion,
          status: "UNSATISFIED" as const,
          detail: unsatisfied.join("; "),
        };
      }
      return {
        criterion,
        status: "SATISFIED" as const,
        detail: "Stateful tracking and deny assertion verified in authorized tree.",
      };
    }

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
    } else if (
      row.status === "UNVERIFIED" &&
      (isMaterialCleanupCriterion(row.criterion) || isMaterialRateLimitCriterion(row.criterion))
    ) {
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
