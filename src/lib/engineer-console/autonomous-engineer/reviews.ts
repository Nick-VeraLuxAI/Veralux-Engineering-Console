import type { AutonomousDocument, AutonomousReviewFinding } from "./types";
import { isPathInReviewScope } from "./authority";
import { contractRegressionDefects } from "./scaffold-contract-guard";
import { isWorktreeInfrastructurePath } from "../workspace/worktree-path-policy";

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

/** Detect circular self-imports of the form `from './same-basename'`. */
function circularSelfImportDefects(fileContents: Record<string, string>): string[] {
  const defects: string[] = [];
  for (const [file, content] of Object.entries(fileContents)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    if (file.includes(".test.") || file.includes("__tests__/")) continue;
    const base = file.split("/").pop()?.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "") ?? "";
    if (!base) continue;
    const selfImport = new RegExp(
      String.raw`(?:import|export)\s+[^;]*\bfrom\s+['"]\.\/${base}(?:\.(?:js|jsx|ts|tsx|mjs|cjs))?['"]`,
    );
    if (selfImport.test(content)) {
      defects.push(
        `${file}: Circular/self-import of './${base}' left in delivery; remove residue instead of wrapping it.`,
      );
    }
  }
  return defects;
}

/** Require implementation classes to expose methods declared on exported interfaces (e.g. MemoryRecordStore). */
export function interfaceMethodConformanceDefects(fileContents: Record<string, string>): string[] {
  const contracts =
    fileContents["src/contracts.ts"] ??
    fileContents["contracts.ts"] ??
    Object.entries(fileContents).find(([path]) => path.endsWith("/contracts.ts") || path === "contracts.ts")?.[1];
  if (!contracts) return [];

  const ifaceBlocks = [
    ...contracts.matchAll(/export\s+interface\s+(\w+)\s*\{([^}]*)\}/gs),
  ];
  const defects: string[] = [];
  const prodBodies = Object.entries(fileContents)
    .filter(
      ([file]) =>
        /\.(ts|tsx|js|jsx)$/.test(file) &&
        !file.includes(".test.") &&
        !file.includes("__tests__/") &&
        !file.endsWith("contracts.ts"),
    )
    .map(([, body]) => body)
    .join("\n");

  for (const match of ifaceBlocks) {
    const ifaceName = match[1];
    const body = match[2] ?? "";
    const methods = [...body.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]);
    if (methods.length === 0) continue;
    // Only enforce for store/log-style domain interfaces that AE commonly misnames.
    if (!/Store|Log|Assembler|Repository/i.test(ifaceName)) continue;
    const missing = methods.filter((method) => {
      const methodRe = new RegExp(String.raw`\b${method}\s*\(`);
      return !methodRe.test(prodBodies);
    });
    if (missing.length > 0) {
      defects.push(
        `src/contracts.ts interface ${ifaceName} requires methods [${methods.join(", ")}] but production sources are missing [${missing.join(", ")}]. Implement InMemory${ifaceName.replace(/^I/, "")} with those exact method names (do not invent create/update aliases).`,
      );
    }
    if (
      /MemoryRecordStore/i.test(ifaceName) &&
      /\bcreate\s*\(/.test(prodBodies) &&
      !/\bupsert\s*\(/.test(prodBodies)
    ) {
      defects.push(
        `MemoryRecordStore implementation uses create() instead of upsert(). Rename to upsert matching the interface.`,
      );
    }
  }
  return defects;
}

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
  defects.push(...circularSelfImportDefects(fileContents));
  defects.push(...interfaceMethodConformanceDefects(fileContents));
  return defects;
}

/** When AC demands cleanup, flag authorized-tree residue even if the file was never changed. */
function cleanupResidueDefects(input: {
  acceptanceCriteria?: string[];
  objective?: string;
  authorizedTree?: string[];
  fileContents?: Record<string, string>;
}): string[] {
  const corpus = [
    ...(input.acceptanceCriteria ?? []),
    input.objective ?? "",
  ]
    .join("\n")
    .toLowerCase();
  if (!/dead|shim|hack|todo|circular|self-import|duplicate|scaffolding/.test(corpus)) {
    return [];
  }
  const defects: string[] = [];
  const tree = input.authorizedTree ?? Object.keys(input.fileContents ?? {});
  for (const relative of tree) {
    if (/dead-shim/i.test(relative)) {
      defects.push(
        `${relative}: Unused dead shim remains in authorized scope; delete_file is required by cleanup acceptance criteria.`,
      );
    }
  }
  for (const [file, content] of Object.entries(input.fileContents ?? {})) {
    if (file.includes(".test.") || file.includes("__tests__/")) continue;
    if (/\/\/\s*(?:HACK|TODO|WORKAROUND|TEMP)\b/i.test(content)) {
      defects.push(`${file}: HACK/TODO scaffolding remains; remove per cleanup acceptance criteria.`);
    }
    if (/export\s+function\s+\w+_(?:v\d+|legacy|shim)\b/.test(content)) {
      defects.push(`${file}: Duplicate/legacy helper exports remain; remove per cleanup acceptance criteria.`);
    }
  }
  return [...new Set(defects)];
}

export function runAutonomousReviews(input: {
  document: AutonomousDocument;
  changedFiles: string[];
  diffSummary: string;
  qcPassed: boolean;
  /** Optional worktree file contents for content-level review defects (fixable via update_file). */
  fileContents?: Record<string, string>;
  /** Authorized tree paths (including unchanged) relevant to cleanup AC. */
  authorizedTree?: string[];
}): AutonomousReviewFinding[] {
  const requirements: AutonomousReviewFinding = {
    review: "requirements",
    passed: Boolean(input.document.interpretedObjective?.requirements.length),
    findings: input.document.interpretedObjective?.requirements ?? [],
    actionableDefects: input.document.interpretedObjective?.requirements.length
      ? []
      : ["Missing interpreted requirements."],
  };

  const reviewableChangedFiles = input.changedFiles.filter(
    (file) => !isWorktreeInfrastructurePath(file),
  );

  const suspicious = reviewableChangedFiles.filter(
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
    passed: suspicious.length === 0 && contentBlockers.length === 0 && reviewableChangedFiles.length > 0,
    findings:
      reviewableChangedFiles.length === 0
        ? ["No changed files to review."]
        : reviewableChangedFiles.map((file) => `Changed ${file}`),
    actionableDefects:
      suspicious.length > 0
        ? suspicious.map((file) => `Protected or unsafe path in diff: ${file}`)
        : contentBlockers.length > 0
          ? contentBlockers.map((file) => `Secret or review-blocker marker in diff: ${file}`)
        : reviewableChangedFiles.length === 0
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

  const outOfScope = reviewableChangedFiles.filter(
    (file) => !isPathInReviewScope(input.document.authorityEnvelope, file),
  );
  const scope: AutonomousReviewFinding = {
    review: "scope",
    passed: outOfScope.length === 0,
    findings: [
      `Changed file count: ${reviewableChangedFiles.length}`,
      input.diffSummary.slice(0, 300) || "No diff summary",
    ],
    actionableDefects: outOfScope.map((file) => `Out of authorized scope: ${file}`),
  };

  const qualityDefects = [
    ...engineeringQualityDefects(input.fileContents ?? {}),
    ...cleanupResidueDefects({
      acceptanceCriteria:
        input.document.interpretedObjective?.acceptanceCriteria ?? input.document.acceptanceCriteria,
      objective: input.document.originalObjective,
      authorizedTree: input.authorizedTree,
      fileContents: input.fileContents,
    }),
    ...contractRegressionDefects({
      hostRepoPath: input.document.authorizedRepoPath,
      worktreeContents: input.fileContents ?? {},
    }),
  ];
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

export type ReviewVerdictKind = "PASS" | "BLOCKING_DEFECT" | "ADVISORY";

export interface AdversarialDefectAssessment {
  material: boolean;
  severity: "blocker" | "advisory";
  verdict: ReviewVerdictKind;
  evidence: string[];
  requiresRepair: boolean;
  reason: string;
  confidence: "low" | "medium" | "high";
  classification?: "REAL_MATERIAL" | "ADVISORY" | "DUPLICATE" | "INVENTED" | "MISREAD" | "TOO_LATE";
}

export interface ReviewGroundingContext {
  fileContents?: Record<string, string>;
  objective?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
  qcPassed?: boolean;
  resolvedFindingIds?: string[];
}

/** Catch blocks that rethrow (not silent success). */
const CATCH_RETHROW =
  /catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,400}?\bthrow\b/m;

/** Actual silent/success-fallback catch shapes in sources. */
const CATCH_SILENT_OR_SUCCESS =
  /catch\s*(?:\([^)]*\))?\s*\{\s*(?:return\s+(?:true|null|undefined|\[\]|\{\})\s*;?\s*)?\}/m;

function sourcesHaveRethrowingCatch(fileContents: Record<string, string> | undefined): boolean {
  return Object.values(fileContents ?? {}).some((content) => CATCH_RETHROW.test(content));
}

function sourcesHaveSilentSuccessCatch(fileContents: Record<string, string> | undefined): boolean {
  return Object.values(fileContents ?? {}).some((content) => {
    if (CATCH_RETHROW.test(content)) return false;
    return (
      ENGINEERING_QUALITY_PATTERNS.some(
        (rule) =>
          (rule.id === "empty_catch" ||
            rule.id === "success_fallback_catch" ||
            rule.id === "silent_console_catch") &&
          rule.pattern.test(content),
      ) || CATCH_SILENT_OR_SUCCESS.test(content)
    );
  });
}

function claimAnchoredToRequirements(
  text: string,
  requirements: string[] | undefined,
  acceptanceCriteria: string[] | undefined,
): boolean {
  const corpus = [...(requirements ?? []), ...(acceptanceCriteria ?? [])].join(" ").toLowerCase();
  if (!corpus.trim()) return true; // no corpus → do not invent anchoring failure
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 4)
    .slice(0, 12);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => corpus.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

/** Merge live worker adversarial review defects into the authoritative review set. */
export function mergeWorkerAdversarialReview(
  reviews: AutonomousReviewFinding[],
  worker: { passed?: unknown; findings?: unknown; actionableDefects?: unknown } | null,
  grounding?: ReviewGroundingContext,
): AutonomousReviewFinding[] {
  if (!worker || typeof worker.passed !== "boolean") return reviews;
  const findings = Array.isArray(worker.findings)
    ? worker.findings.filter((item): item is string => typeof item === "string")
    : [];
  const rawDefects = Array.isArray(worker.actionableDefects)
    ? worker.actionableDefects.filter((item): item is string => typeof item === "string")
    : [];
  // Only gate on material engineering defects. Advisory perfectionism / invented product
  // requirements / generic "consider race testing" become findings, not delivery blockers.
  const assessed = rawDefects.map((defect) => ({
    defect,
    assessment: assessAdversarialDefect(defect, grounding),
  }));
  const materialDefects = assessed.filter((item) => item.assessment.material).map((item) => item.defect);
  const advisory = assessed.filter((item) => !item.assessment.material);
  const adversarial: AutonomousReviewFinding = {
    review: "worker_adversarial",
    passed: materialDefects.length === 0,
    findings: [
      ...findings,
      ...advisory.map(
        (item) =>
          `Advisory (non-blocking): ${item.defect}` +
          (item.assessment.reason ? ` [${item.assessment.reason}]` : ""),
      ),
    ].filter(Boolean),
    actionableDefects: materialDefects,
  };
  return [...reviews.filter((review) => review.review !== "worker_adversarial"), adversarial];
}

/** Non-race material engineering defects (unchanged fail-closed bar for real smells). */
const MATERIAL_NON_RACE =
  /(?:empty catch|success[- ]?fallback|fail open|swallowed(?:\s+error)?|silent (?:null|success|fail)|WORKAROUND|\bHACK\b|circular(?:\/|\s+)?self[- ]?import|self-import|from ['"]vitest['"]|does not export expect|private key|AE_REVIEW_BLOCK|trust boundar|auth hole|partial mutat(?:ion)? without|N\+1(?:\s+query)?|sql inject|path traversal)/i;

/** Claims that often misread rethrowing catches as silent success. */
const SILENT_SUCCESS_CLAIM =
  /silent\s+success|silently\s+treat|swallowed(?:\s+error)?|success[- ]?fallback|callers?\s+may\s+swallow/i;

/** Race/concurrency keywords alone are insufficient — need concrete evidence. */
const RACE_KEYWORD =
  /\b(?:race(?:\s+condition)?s?|concurrent(?:ly)?|concurrency|lost\s+update|double[- ](?:apply|exec|spend))\b/i;

/** Advisory-only race phrasing (invented / overstated test-gap advice). */
const RACE_ADVISORY_ONLY =
  /(?:consider|recommend|suggest|should|could|might|missing)\b[\s\S]{0,80}\brace(?:\s+condition)?s?\b|\brace(?:\s+condition)?s?\b[\s\S]{0,40}\b(?:test(?:ing)?|coverage|consider)\b|no\s+race\s+test|add\s+race\s+test|race\s+testing/i;

/** Concrete race/concurrency evidence that may block. */
const RACE_CONCRETE_EVIDENCE = [
  /unsafe\s+shared\s+state/i,
  /non[- ]atomic\s+(?:mutation|update|write|read)/i,
  /shared\s+\w[\w.]*\s+(?:mutated|updated|written)\s+without/i,
  /without\s+(?:a\s+)?(?:lock|mutex|synchroniz|revision|version\s+check|atomic|compare[- ]and[- ]swap|CAS)\b/i,
  /missing\s+(?:sync|lock|mutex|atomic|revision|version)\b/i,
  /reproducible\s+race/i,
  /failing\s+adversarial\s+test/i,
  /demonstrated\s+race/i,
  /TOCTOU|check[- ]then[- ]act/i,
  /contract\s+requir(?:es|ing)\s+concurren/i,
  /security\s+impact[\s\S]{0,100}(?:impl(?:ementation)?|evidence|code|diff|mutation)/i,
  /lost\s+update\s+under\s+concurrent/i,
  /double[- ](?:apply|exec|spend)\s+(?:under|via|when|because)/i,
];

/**
 * Structured materiality gate (WP1) with optional current-state grounding.
 * Broad keyword filters (`race` / `concurrent` / speculative silent-success) must NOT solely block.
 */
export function assessAdversarialDefect(
  summary: string,
  grounding?: ReviewGroundingContext,
): AdversarialDefectAssessment {
  const text = summary.trim();
  if (!text) {
    return {
      material: false,
      severity: "advisory",
      verdict: "ADVISORY",
      evidence: [],
      requiresRepair: false,
      reason: "empty defect summary",
      confidence: "high",
      classification: "ADVISORY",
    };
  }

  // Prefer structured markers when the worker emits them.
  if (/\brequires_repair\s*[:=]\s*false\b/i.test(text) || /\bmaterial\s*[:=]\s*false\b/i.test(text)) {
    return {
      material: false,
      severity: "advisory",
      verdict: "ADVISORY",
      evidence: [],
      requiresRepair: false,
      reason: "structured non-material marker",
      confidence: "high",
      classification: "ADVISORY",
    };
  }
  if (/\brequires_repair\s*[:=]\s*true\b/i.test(text) && /\bmaterial\s*[:=]\s*true\b/i.test(text)) {
    const structuredEvidence = [...text.matchAll(/evidence\s*[:=]\s*([^;|]+)/gi)].map((m) => m[1].trim());
    if (structuredEvidence.length > 0 || RACE_CONCRETE_EVIDENCE.some((re) => re.test(text))) {
      return {
        material: true,
        severity: "blocker",
        verdict: "BLOCKING_DEFECT",
        evidence: structuredEvidence.length ? structuredEvidence : [text],
        requiresRepair: true,
        reason: "structured material marker with evidence",
        confidence: "high",
        classification: "REAL_MATERIAL",
      };
    }
  }

  // Ground silent-success / swallowed-error claims against final sources (fb5eab66 class).
  if (SILENT_SUCCESS_CLAIM.test(text) && grounding?.fileContents) {
    if (sourcesHaveRethrowingCatch(grounding.fileContents) && !sourcesHaveSilentSuccessCatch(grounding.fileContents)) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: ["catch block rethrows after recording failure"],
        requiresRepair: false,
        reason: "misread: sources rethrow on store/mutation errors (not silent success)",
        confidence: "high",
        classification: "MISREAD",
      };
    }
    if (!sourcesHaveSilentSuccessCatch(grounding.fileContents)) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: [],
        requiresRepair: false,
        reason: "invented silent-success risk without empty/success-fallback catch in diff",
        confidence: "high",
        classification: "INVENTED",
      };
    }
  }

  // "Missing negative tests …" without a real smell in sources → advisory test-gap advice.
  if (
    /missing\s+negative\s+tests/i.test(text) &&
    grounding?.fileContents &&
    !sourcesHaveSilentSuccessCatch(grounding.fileContents) &&
    !MATERIAL_NON_RACE.test(text.replace(SILENT_SUCCESS_CLAIM, " "))
  ) {
    const stillSilentClaim = SILENT_SUCCESS_CLAIM.test(text);
    if (stillSilentClaim && sourcesHaveRethrowingCatch(grounding.fileContents)) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: ["rethrow path present"],
        requiresRepair: false,
        reason: "advisory test-gap; silent-success claim contradicted by rethrow",
        confidence: "high",
        classification: "MISREAD",
      };
    }
  }

  if (MATERIAL_NON_RACE.test(text)) {
    // Requirement anchoring: speculative caller-behavior claims outside objective stay advisory
    // unless sources actually contain the smell.
    if (
      /callers?\s+may\s+swallow/i.test(text) &&
      grounding?.fileContents &&
      !sourcesHaveSilentSuccessCatch(grounding.fileContents)
    ) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: [],
        requiresRepair: false,
        reason: "speculative caller behavior not grounded in changed sources",
        confidence: "medium",
        classification: "INVENTED",
      };
    }
    if (
      grounding &&
      !claimAnchoredToRequirements(text, grounding.requirements, grounding.acceptanceCriteria) &&
      /missing\s+negative\s+tests|consider|recommend/i.test(text) &&
      !sourcesHaveSilentSuccessCatch(grounding.fileContents)
    ) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: [],
        requiresRepair: false,
        reason: "finding not anchored to requirements/AC and no source smell",
        confidence: "medium",
        classification: "ADVISORY",
      };
    }
    return {
      material: true,
      severity: "blocker",
      verdict: "BLOCKING_DEFECT",
      evidence: [text],
      requiresRepair: true,
      reason: "non-race material engineering defect",
      confidence: "high",
      classification: "REAL_MATERIAL",
    };
  }

  if (RACE_KEYWORD.test(text)) {
    if (RACE_ADVISORY_ONLY.test(text) && !RACE_CONCRETE_EVIDENCE.some((re) => re.test(text))) {
      return {
        material: false,
        severity: "advisory",
        verdict: "ADVISORY",
        evidence: [],
        requiresRepair: false,
        reason: "generic race/concurrency advice without concrete evidence",
        confidence: "high",
        classification: "ADVISORY",
      };
    }
    const matchedEvidence = RACE_CONCRETE_EVIDENCE.filter((re) => re.test(text)).map((re) => re.source);
    if (matchedEvidence.length > 0) {
      return {
        material: true,
        severity: "blocker",
        verdict: "BLOCKING_DEFECT",
        evidence: matchedEvidence,
        requiresRepair: true,
        reason: "race/concurrency claim with concrete evidence",
        confidence: "high",
        classification: "REAL_MATERIAL",
      };
    }
    // Keyword-only race claim → advisory (does not reopen delivery).
    return {
      material: false,
      severity: "advisory",
      verdict: "ADVISORY",
      evidence: [],
      requiresRepair: false,
      reason: "race/concurrency keyword without concrete evidence",
      confidence: "high",
      classification: "ADVISORY",
    };
  }

  return {
    material: false,
    severity: "advisory",
    verdict: "ADVISORY",
    evidence: [],
    requiresRepair: false,
    reason: "non-material advisory finding",
    confidence: "medium",
    classification: "ADVISORY",
  };
}

export function isMaterialAdversarialDefect(
  summary: string,
  grounding?: ReviewGroundingContext,
): boolean {
  return assessAdversarialDefect(summary, grounding).material;
}

export function reviewsHaveActionableDefects(reviews: AutonomousReviewFinding[]): boolean {
  return reviews.some((review) => review.actionableDefects.length > 0);
}

/** Build current-state grounding blob for the live worker review prompt. */
export function buildReviewGroundingPrompt(input: {
  document: AutonomousDocument;
  changedFiles: string[];
  diffSummary: string;
  fileContents: Record<string, string>;
  heuristicReviews: AutonomousReviewFinding[];
}): string {
  const resolved = (input.document.reviewFindingLedger ?? [])
    .filter((row) => row.status === "RESOLVED")
    .map((row) => row.findingId);
  return [
    "Perform an adversarial senior review grounded in CURRENT state only.",
    "Output JSON only: {passed, findings, actionableDefects}.",
    "Each actionableDefect must be material with concrete evidence from the supplied files/diff.",
    "Classify severity as PASS | BLOCKING_DEFECT | ADVISORY. Only BLOCKING_DEFECT goes in actionableDefects.",
    "Do not invent silent-success when catch rethrows. Do not invent product requirements.",
    "Anchor material findings to objective requirements/acceptance criteria when claiming gaps.",
    `Objective: ${input.document.originalObjective}`,
    `Requirements: ${(input.document.interpretedObjective?.requirements ?? input.document.requirements).join("; ")}`,
    `Acceptance criteria: ${(input.document.interpretedObjective?.acceptanceCriteria ?? input.document.acceptanceCriteria).join("; ")}`,
    `QC objectiveQcPassed: ${input.document.qcDelta?.objectiveQcPassed ?? true}`,
    `Resolved finding ids: ${resolved.join(", ") || "(none)"}`,
    `Changed files: ${input.changedFiles.join(", ")}`,
    `File contents:\n${Object.entries(input.fileContents)
      .map(([file, content]) => `--- ${file} ---\n${content}`)
      .join("\n\n")
      .slice(0, 12_000)}`,
    `Diff:\n${input.diffSummary.slice(0, 3000)}`,
    `Heuristic reviews: ${JSON.stringify(input.heuristicReviews)}`,
  ].join("\n");
}
