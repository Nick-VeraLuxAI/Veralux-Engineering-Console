import type { AutonomousDocument, AutonomousReviewFinding } from "./types";
import { isPathAuthorized } from "./authority";

const CONTENT_REVIEW_BLOCKERS = [
  /BEGIN (RSA )?PRIVATE KEY/,
  /AE_REVIEW_BLOCK/,
];

/** Deterministic smells that block delivery when present in changed sources. */
const ENGINEERING_QUALITY_PATTERNS: Array<{ id: string; pattern: RegExp; message: string }> = [
  {
    id: "empty_catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/m,
    message: "Empty catch swallows errors; record failure or rethrow.",
  },
  {
    id: "success_fallback_catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:true|null|undefined|\[\]|\{\})\s*;?\s*\}/m,
    message: "Catch returns success/empty fallback; fail closed or surface the error.",
  },
  {
    id: "silent_console_catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*console\.(?:log|warn|error)\([^)]*\)\s*;?\s*\}/m,
    message: "Catch only logs; persist a structured failure record for callers.",
  },
  {
    id: "vitest_in_production",
    pattern: /from\s+['"]vitest['"]|require\(['"]vitest['"]\)/,
    message: "Production source imports vitest; keep vitest imports in *.test.* files only.",
  },
  {
    id: "invalid_node_test_expect",
    pattern: /import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]node:test['"]/,
    message: "node:test does not export expect; use node:assert/strict (or Vitest only if package.json runs vitest).",
  },
  {
    id: "workaround_stack",
    pattern: /\/\/\s*(?:WORKAROUND|HACK|TEMP)\b/i,
    message: "Workaround/HACK marker in delivery path; repair the underlying defect instead.",
  },
];

function engineeringQualityDefects(fileContents: Record<string, string>): string[] {
  const defects: string[] = [];
  for (const [file, content] of Object.entries(fileContents)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    const isTest = file.includes(".test.") || file.includes("__tests__/");
    for (const rule of ENGINEERING_QUALITY_PATTERNS) {
      if (isTest && rule.id !== "invalid_node_test_expect" && rule.id !== "workaround_stack") {
        continue;
      }
      if (!isTest && rule.id === "invalid_node_test_expect") {
        continue;
      }
      if (rule.pattern.test(content)) {
        defects.push(`${file}: ${rule.message}`);
      }
    }
  }
  return defects;
}

export function runAutonomousReviews(input: {
  document: AutonomousDocument;
  changedFiles: string[];
  diffSummary: string;
  qcPassed: boolean;
  /** Optional worktree file contents for content-level review defects (fixable via update_file). */
  fileContents?: Record<string, string>;
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
  const contentBlockers = Object.entries(input.fileContents ?? {})
    .filter(([, content]) => CONTENT_REVIEW_BLOCKERS.some((pattern) => pattern.test(content)))
    .map(([file]) => file);
  const diffQuality: AutonomousReviewFinding = {
    review: "diff_quality",
    passed: suspicious.length === 0 && contentBlockers.length === 0 && input.changedFiles.length > 0,
    findings:
      input.changedFiles.length === 0
        ? ["No changed files to review."]
        : input.changedFiles.map((file) => `Changed ${file}`),
    actionableDefects:
      suspicious.length > 0
        ? suspicious.map((file) => `Protected or unsafe path in diff: ${file}`)
        : contentBlockers.length > 0
          ? contentBlockers.map((file) => `Secret or review-blocker marker in diff: ${file}`)
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

  const qualityDefects = engineeringQualityDefects(input.fileContents ?? {});
  const engineeringQuality: AutonomousReviewFinding = {
    review: "engineering_quality",
    passed: qualityDefects.length === 0,
    findings:
      qualityDefects.length === 0
        ? ["No deterministic engineering-quality blockers in changed sources."]
        : qualityDefects,
    actionableDefects: qualityDefects,
  };

  return [requirements, diffQuality, regressionRisk, scope, engineeringQuality];
}

/** Merge live worker adversarial review defects into the authoritative review set. */
export function mergeWorkerAdversarialReview(
  reviews: AutonomousReviewFinding[],
  worker: { passed?: unknown; findings?: unknown; actionableDefects?: unknown } | null,
): AutonomousReviewFinding[] {
  if (!worker || typeof worker.passed !== "boolean") return reviews;
  const findings = Array.isArray(worker.findings)
    ? worker.findings.filter((item): item is string => typeof item === "string")
    : [];
  const rawDefects = Array.isArray(worker.actionableDefects)
    ? worker.actionableDefects.filter((item): item is string => typeof item === "string")
    : [];
  // Only gate on material engineering defects. Advisory perfectionism / invented product
  // requirements become findings, not delivery blockers.
  const materialDefects = rawDefects.filter((defect) => isMaterialAdversarialDefect(defect));
  const advisory = rawDefects.filter((defect) => !isMaterialAdversarialDefect(defect));
  const adversarial: AutonomousReviewFinding = {
    review: "worker_adversarial",
    passed: materialDefects.length === 0,
    findings: [
      ...findings,
      ...advisory.map((defect) => `Advisory (non-blocking): ${defect}`),
    ].filter(Boolean),
    actionableDefects: materialDefects,
  };
  return [...reviews.filter((review) => review.review !== "worker_adversarial"), adversarial];
}

const MATERIAL_ADVERSARIAL =
  /(?:\brace\b|lost update|double[- ](?:apply|exec|spend)|empty catch|success[- ]?fallback|fail open|swallowed(?:\s+error)?|silent (?:null|success|fail)|WORKAROUND|\bHACK\b|from ['"]vitest['"]|does not export expect|private key|AE_REVIEW_BLOCK|trust boundar|auth hole|partial mutat(?:ion)? without|N\+1(?:\s+query)?|sql inject|path traversal)/i;

export function isMaterialAdversarialDefect(summary: string): boolean {
  return MATERIAL_ADVERSARIAL.test(summary);
}

export function reviewsHaveActionableDefects(reviews: AutonomousReviewFinding[]): boolean {
  return reviews.some((review) => review.actionableDefects.length > 0);
}
