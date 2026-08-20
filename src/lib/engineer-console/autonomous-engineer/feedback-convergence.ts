/**
 * Targeted feedback-loop convergence helpers (WP1–WP7).
 * No SkillOpt, no weight changes, no budget ceiling raises.
 */
import fs from "fs";
import path from "path";
import type {
  AutonomousDocument,
  DiagnosisResult,
  FailedHypothesis,
  PriorAttemptRecord,
  QcObservation,
} from "./types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { listAuthorizedWorktreeFiles } from "./plan-worktree-adapter";

export const FAILURE_SIGNATURES = [
  "ESM_REQUIRE_USAGE",
  "INVALID_NODE_ASSERT_API",
  "INVALID_NODE_TEST_EXPECT",
  "VITEST_HOOK_UNDER_NODE_TEST",
  "LITERAL_ESCAPED_NEWLINES",
  "INVENTED_TEST_RUNNER_API",
] as const;

export type FailureSignature = (typeof FAILURE_SIGNATURES)[number];

export interface RepoTestGroundingFacts {
  moduleType: "module" | "commonjs" | "unknown";
  testCommand: string;
  assertionLib: "node:assert" | "vitest" | "unknown";
  runner: "node:test" | "vitest" | "unknown";
  factsBlock: string;
}

export interface TestExemplar {
  path: string;
  content: string;
  proximityScore: number;
}

export interface FailureSignatureRecord {
  signature: FailureSignature;
  iterations: number[];
  count: number;
}

export interface DiagnosisConsistencyResult {
  authoritative: boolean;
  reasons: string[];
  unsupportedClaims: string[];
}

export interface StructuredDiagnosisFields {
  observed_failure: string;
  evidence_quote_or_signature: string;
  affected_file_or_gate: string;
  root_cause_hypothesis: string;
  confidence: "low" | "medium" | "high";
  contradictory_evidence: string;
  recommended_strategy_change: string;
  avoid_repeating: string;
}

export interface HarnessGuardFinding {
  path: string;
  signature: FailureSignature;
  message: string;
}

const TEST_PATH_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$|\/__tests__\//;
const EVIDENCE_SLICE_CHARS = 520;

function isTestPath(relative: string): boolean {
  return TEST_PATH_RE.test(relative) || relative.includes("__tests__/");
}

export function readRepoTestGroundingFacts(repoPath: string): RepoTestGroundingFacts {
  let moduleType: RepoTestGroundingFacts["moduleType"] = "unknown";
  let testCommand = "(none)";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, "package.json"), "utf8")) as {
      type?: string;
      scripts?: Record<string, string>;
    };
    if (pkg.type === "module") moduleType = "module";
    else if (pkg.type === "commonjs") moduleType = "commonjs";
    else moduleType = "commonjs";
    testCommand = pkg.scripts?.test ?? "(none)";
  } catch {
    // keep defaults
  }

  const usesNodeTest = /\bnode\s+--test\b|\bnode:test\b/.test(testCommand);
  const usesVitest = /\bvitest\b/.test(testCommand);
  const runner: RepoTestGroundingFacts["runner"] = usesNodeTest
    ? "node:test"
    : usesVitest
      ? "vitest"
      : "unknown";
  const assertionLib: RepoTestGroundingFacts["assertionLib"] = usesNodeTest
    ? "node:assert"
    : usesVitest
      ? "vitest"
      : "unknown";

  const factsBlock = [
    `Repo module type: ${moduleType === "module" ? "ESM (package.json type:module)" : moduleType}`,
    `Test command: ${testCommand}`,
    `Expected runner: ${runner}`,
    `Expected assertion library: ${assertionLib}`,
    moduleType === "module"
      ? "Deterministic: never use require() in new/changed tests or ESM sources under type:module."
      : "",
    runner === "node:test"
      ? "Deterministic: use import test from 'node:test'; import assert from 'node:assert/strict'; never expect/describe/it from node:test; never assert.throwsAsync (use await assert.rejects)."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { moduleType, testCommand, assertionLib, runner, factsBlock };
}

/** Rank known-good test exemplars by proximity to focus paths / authorized prefixes. */
export function readAuthorizedTestExemplars(
  repoPath: string,
  prefixes: string[],
  options: {
    maxFiles?: number;
    maxBytesPerFile?: number;
    focusPaths?: string[];
  } = {},
): TestExemplar[] {
  const maxFiles = Math.min(3, options.maxFiles ?? 3);
  const maxBytesPerFile = options.maxBytesPerFile ?? 1_200;
  const focusPaths = options.focusPaths ?? [];
  const files = listAuthorizedWorktreeFiles(repoPath, prefixes, 64).filter(isTestPath);

  const scored = files
    .map((relative) => {
      const absolute = path.join(repoPath, relative);
      let size = Number.MAX_SAFE_INTEGER;
      let content = "";
      try {
        const raw = fs.readFileSync(absolute, "utf8");
        size = raw.length;
        content = raw.slice(0, maxBytesPerFile);
      } catch {
        return null;
      }
      // Prefer known-good patterns over broken harness inventions.
      const looksHarnessValid =
        /from\s+['"]node:test['"]/.test(content) ||
        /from\s+['"]vitest['"]/.test(content) ||
        /require\(['"]node:test['"]\)/.test(content);
      const looksBroken =
        /\brequire\s*\(/.test(content) ||
        /assert\.throwsAsync/.test(content) ||
        /import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]node:test['"]/.test(content);
      let proximity = 0;
      for (const focus of focusPaths) {
        const focusDir = path.posix.dirname(focus.replace(/\\/g, "/"));
        const relDir = path.posix.dirname(relative);
        if (relative === focus) proximity += 100;
        else if (relDir === focusDir) proximity += 50;
        else if (relDir.startsWith(focusDir) || focusDir.startsWith(relDir)) proximity += 25;
        else if (path.posix.basename(relative).includes(path.posix.basename(focusDir))) proximity += 10;
      }
      if (looksHarnessValid && !looksBroken) proximity += 20;
      if (looksBroken) proximity -= 30;
      // Prefer smaller exemplars.
      proximity += Math.max(0, 10 - Math.floor(size / 400));
      return { path: relative, content, proximityScore: proximity, size };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.proximityScore - a.proximityScore || a.size - b.size)
    .slice(0, maxFiles)
    .map(({ path: p, content, proximityScore }) => ({ path: p, content, proximityScore }));

  return scored;
}

export function formatTestExemplarBlock(exemplars: TestExemplar[]): string {
  if (exemplars.length === 0) {
    return "(no authorized test exemplars found under prefixes)";
  }
  return exemplars
    .map((ex) => `--- known-good test exemplar: ${ex.path} ---\n${ex.content}`)
    .join("\n\n");
}

/** Compact digest of proven failed approaches only (QC/parser/runtime/validator supported). */
export function buildPriorAttemptDigest(input: {
  priorAttempts: PriorAttemptRecord[];
  failedHypotheses: FailedHypothesis[];
  qcObservations: QcObservation[];
  failureSignatures?: FailureSignatureRecord[];
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? 1_400;
  const lines: string[] = ["Prior-attempt digest (proven failures only — do not repeat):"];

  for (const attempt of input.priorAttempts.filter((a) => a.outcome === "failed").slice(-6)) {
    const qc =
      attempt.qcSummary ||
      input.qcObservations.find((obs) => obs.iteration === attempt.iteration)?.summary ||
      "";
    const hyp = input.failedHypotheses.find((h) => h.iteration === attempt.iteration);
    const proven = [attempt.summary, qc, hyp?.whyFailed].filter(Boolean).join(" | ").slice(0, 220);
    lines.push(`- iter ${attempt.iteration}: strategy="${attempt.strategy.slice(0, 80)}" → ${proven}`);
  }

  if (input.failureSignatures && input.failureSignatures.length > 0) {
    lines.push("Repeated failure signatures:");
    for (const sig of input.failureSignatures) {
      const level =
        sig.count >= 3 ? "BLOCK identical strategy without new repo evidence" : sig.count === 2 ? "WARNING" : "noted";
      lines.push(
        `- ${sig.signature} x${sig.count} (iters ${sig.iterations.join(",")}): ${level}`,
      );
    }
  }

  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 20)}\n…(digest truncated)` : text;
}

export function sliceOwnedFailureEvidence(
  items: Array<{ identity: { name: string; rawEvidence?: string } }>,
  maxChars = EVIDENCE_SLICE_CHARS,
): string {
  if (items.length === 0) return "(none)";
  return items
    .map((item) => {
      const raw = item.identity.rawEvidence ?? "";
      // Prefer lines with TypeError/ReferenceError/FAIL/file:line over noise.
      const preferred =
        raw
          .split(/\r?\n/)
          .filter((line) =>
            /TypeError|ReferenceError|Error:|FAIL|not a function|is not defined|Cannot find|at\s+\S+:\d+|throwsAsync|require\s+is not|expect/.test(
              line,
            ),
          )
          .join("\n") || raw;
      const slice = preferred.slice(0, maxChars);
      return `${item.identity.name} :: ${slice}`;
    })
    .join("\n---\n");
}

export function detectFailureSignaturesInText(text: string): FailureSignature[] {
  const found = new Set<FailureSignature>();
  if (/\brequire\s*\(|require is not defined|Cannot use import statement|ES module/i.test(text)) {
    found.add("ESM_REQUIRE_USAGE");
  }
  if (/throwsAsync|assert\.rejects is not|is not a function/.test(text) && /throwsAsync|assert\./.test(text)) {
    found.add("INVALID_NODE_ASSERT_API");
  }
  if (/throwsAsync/.test(text)) found.add("INVALID_NODE_ASSERT_API");
  if (/does not provide export named ['"]expect['"]|import\s*\{[^}]*expect[^}]*\}\s*from\s*['"]node:test['"]/.test(text)) {
    found.add("INVALID_NODE_TEST_EXPECT");
  }
  if (/\bbeforeEach\b|\bafterEach\b|\bdescribe\b|\bit\s*\(/.test(text) && /node --test|node:test/.test(text)) {
    found.add("VITEST_HOOK_UNDER_NODE_TEST");
  }
  if (/\\n/.test(text) && /SyntaxError|Unexpected/.test(text)) {
    found.add("LITERAL_ESCAPED_NEWLINES");
  }
  if (/\bdefine\s*\(/.test(text) && /test|node:test/.test(text)) {
    found.add("INVENTED_TEST_RUNNER_API");
  }
  return [...found];
}

export function detectFailureSignaturesInPlan(plan: WorkerPlan, facts: RepoTestGroundingFacts): FailureSignature[] {
  const found = new Set<FailureSignature>();
  for (const op of plan.operations ?? []) {
    if (!isTestPath(op.path) && !/\.(js|ts|mjs|cjs)$/.test(op.path)) continue;
    const content = op.content ?? "";
    for (const sig of detectHarnessSignaturesInContent(op.path, content, facts)) {
      found.add(sig.signature);
    }
  }
  return [...found];
}

export function detectHarnessSignaturesInContent(
  filePath: string,
  content: string,
  facts: RepoTestGroundingFacts,
): HarnessGuardFinding[] {
  const findings: HarnessGuardFinding[] = [];
  const isTest = isTestPath(filePath);
  if (!isTest && !/\.(js|mjs|cjs|ts)$/.test(filePath)) return findings;

  if (facts.moduleType === "module" && isTest && /\brequire\s*\(/.test(content)) {
    findings.push({
      path: filePath,
      signature: "ESM_REQUIRE_USAGE",
      message: `${filePath}: ESM package forbids require() in tests; use import.`,
    });
  }
  if (isTest && /assert\.throwsAsync\b/.test(content)) {
    findings.push({
      path: filePath,
      signature: "INVALID_NODE_ASSERT_API",
      message: `${filePath}: assert.throwsAsync is not a Node assert API; use await assert.rejects(...).`,
    });
  }
  if (isTest && /import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]node:test['"]/.test(content)) {
    findings.push({
      path: filePath,
      signature: "INVALID_NODE_TEST_EXPECT",
      message: `${filePath}: node:test does not export expect; use node:assert/strict.`,
    });
  }
  if (
    isTest &&
    facts.runner === "node:test" &&
    (/\bbeforeEach\s*\(/.test(content) || /\bafterEach\s*\(/.test(content)) &&
    !/from\s+['"]node:test['"]/.test(content)
  ) {
    findings.push({
      path: filePath,
      signature: "VITEST_HOOK_UNDER_NODE_TEST",
      message: `${filePath}: Vitest/Jest hooks under node --test without node:test imports.`,
    });
  }
  if (isTest && facts.runner === "node:test" && /\bdefine\s*\(/.test(content) && !/\btest\s*\(/.test(content)) {
    findings.push({
      path: filePath,
      signature: "INVENTED_TEST_RUNNER_API",
      message: `${filePath}: invented define(...) runner API; use test() from node:test.`,
    });
  }
  // Serialization corruption: entire file uses literal \n escapes as statement separators
  // (not legitimate "hello\nworld" string escapes, and not real newlines after JSON decode).
  if (/\.(js|mjs|cjs|ts|tsx)$/.test(filePath) && hasLiteralEscapedNewlineCorruption(content)) {
    findings.push({
      path: filePath,
      signature: "LITERAL_ESCAPED_NEWLINES",
      message: `${filePath}: file content appears to contain literal \\n escapes instead of real newlines.`,
    });
  }
  return findings;
}

/**
 * Detect whole-file escaped-newline corruption after JSON decode.
 * Reject: single physical line where `\\n` separates statements.
 * Allow: real newlines; legitimate string escapes like `"hello\\nworld"`.
 */
export function hasLiteralEscapedNewlineCorruption(content: string): boolean {
  if (!content || content.length < 40) return false;
  // Valid real newlines already present → not whole-file escape corruption.
  if (content.includes("\n") || content.includes("\r")) return false;
  if (!content.includes("\\n")) return false;

  const parts = content.split("\\n");
  if (parts.length < 3) {
    // One or two escapes — typically a legitimate string escape on a one-liner.
    return false;
  }

  const STATEMENT_START =
    /^\s*(?:import\s|export\s|const\s|let\s|var\s|function\s|class\s|return\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|await\s|async\s|type\s|interface\s|describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert\.|}|{\s*$)/;
  const statementy = parts.filter((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;
    return STATEMENT_START.test(trimmed) || /;\s*$/.test(trimmed);
  });
  return statementy.length >= 2;
}

/** Minimal deterministic harness guards on plan operations (WP6). */
export function validatePlanHarnessGuards(
  plan: WorkerPlan,
  facts: RepoTestGroundingFacts,
): HarnessGuardFinding[] {
  const findings: HarnessGuardFinding[] = [];
  for (const op of plan.operations ?? []) {
    findings.push(...detectHarnessSignaturesInContent(op.path, op.content ?? "", facts));
  }
  return findings;
}

/** Fast pre-QC on changed test files in the worktree (WP7). */
export function validateChangedTestHarness(
  repoPath: string,
  changedFiles: string[],
  facts: RepoTestGroundingFacts,
): HarnessGuardFinding[] {
  const findings: HarnessGuardFinding[] = [];
  for (const relative of changedFiles.filter(isTestPath)) {
    const absolute = path.join(repoPath, relative);
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      const content = fs.readFileSync(absolute, "utf8");
      findings.push(...detectHarnessSignaturesInContent(relative, content, facts));
    } catch {
      // skip unreadable
    }
  }
  return findings;
}

export function recordFailureSignatures(
  history: FailureSignatureRecord[],
  signatures: FailureSignature[],
  iteration: number,
): FailureSignatureRecord[] {
  const next = history.map((entry) => ({ ...entry, iterations: [...entry.iterations] }));
  for (const signature of signatures) {
    const existing = next.find((entry) => entry.signature === signature);
    if (existing) {
      if (!existing.iterations.includes(iteration)) {
        existing.iterations.push(iteration);
        existing.count = existing.iterations.length;
      }
    } else {
      next.push({ signature, iterations: [iteration], count: 1 });
    }
  }
  return next;
}

export function repeatedFailureWarningLevel(
  history: FailureSignatureRecord[],
  signature: FailureSignature,
): "none" | "normal" | "warning" | "block" {
  const entry = history.find((h) => h.signature === signature);
  if (!entry) return "none";
  if (entry.count >= 3) return "block";
  if (entry.count === 2) return "warning";
  return "normal";
}

/**
 * Occ3+: reject effectively identical harness strategy when the same signature
 * reappears in the new plan without new repo evidence markers.
 */
export function shouldBlockRepeatedHarnessStrategy(
  history: FailureSignatureRecord[],
  planSignatures: FailureSignature[],
): { block: boolean; signatures: FailureSignature[]; message: string } {
  const blocked = planSignatures.filter((sig) => repeatedFailureWarningLevel(history, sig) === "block");
  if (blocked.length === 0) {
    return { block: false, signatures: [], message: "" };
  }
  return {
    block: true,
    signatures: blocked,
    message: `Repeated harness failure (${blocked.join(", ")}) occurred 3+ times; do not reuse the same approach without new repo evidence (exemplars / package.json runner facts).`,
  };
}

/** Reject worker diagnoses that invent claims unsupported by QC evidence (WP4). */
export function checkDiagnosisConsistency(
  diagnosis: { whyPreviousFailed?: string; suggestedStrategy?: string; root_cause_hypothesis?: string } | null,
  evidenceText: string,
): DiagnosisConsistencyResult {
  if (!diagnosis) {
    return { authoritative: false, reasons: ["No diagnosis present"], unsupportedClaims: [] };
  }
  const narrative = [
    diagnosis.whyPreviousFailed ?? "",
    diagnosis.suggestedStrategy ?? "",
    diagnosis.root_cause_hypothesis ?? "",
  ].join("\n");
  const evidence = evidenceText || "";
  const unsupported: string[] = [];

  const claimsExpect =
    /\bexpect\b/i.test(narrative) && /vitest|jest|from ['"]node:test['"]/i.test(narrative);
  const evidenceHasExpect = /\bexpect\b/.test(evidence);
  if (claimsExpect && !evidenceHasExpect) {
    unsupported.push("Diagnosis cites expect/Vitest but QC evidence has no expect");
  }

  const claimsThrowsAsync = /throwsAsync/i.test(narrative);
  const evidenceHasThrowsAsync = /throwsAsync/i.test(evidence);
  // Claiming throwsAsync when evidence is about something else and not throwsAsync is ok as strategy tip;
  // claiming the failure WAS expect when evidence shows throwsAsync is the inconsistency we care about.
  if (/\bexpect\b/i.test(narrative) && evidenceHasThrowsAsync && !evidenceHasExpect) {
    unsupported.push("Diagnosis cites expect while evidence shows throwsAsync");
  }

  const claimsRequire = /\brequire\b/i.test(narrative);
  const evidenceHasRequire = /require/i.test(evidence);
  if (/\bexpect\b/i.test(narrative) && evidenceHasRequire && !evidenceHasExpect && !claimsRequire) {
    unsupported.push("Diagnosis cites expect while evidence shows require/ESM mismatch");
  }

  // Generic Vitest blame with no vitest/expect in evidence.
  if (
    /\bvitest\b/i.test(narrative) &&
    !/\bvitest\b/i.test(evidence) &&
    !evidenceHasExpect &&
    (evidenceHasRequire || evidenceHasThrowsAsync || /is not a function|is not defined|TypeError|ReferenceError/.test(evidence))
  ) {
    unsupported.push("Diagnosis blames Vitest without Vitest evidence while QC shows another harness error");
  }

  void claimsThrowsAsync;
  return {
    authoritative: unsupported.length === 0,
    reasons: unsupported.length === 0 ? ["Diagnosis claims align with supplied QC evidence"] : unsupported,
    unsupportedClaims: unsupported,
  };
}

export function buildDeterministicDiagnosisFromEvidence(input: {
  failureClass: DiagnosisResult["failureClass"];
  evidenceText: string;
  qcSummary?: string;
  failedHypothesis?: string;
  signatures?: FailureSignature[];
}): DiagnosisResult & StructuredDiagnosisFields {
  const evidence = input.evidenceText.slice(0, EVIDENCE_SLICE_CHARS) || input.qcSummary || "QC failed";
  const signatures = input.signatures?.length
    ? input.signatures
    : detectFailureSignaturesInText(evidence);
  const primary = signatures[0];

  let hypothesis = "Owned QC failure; repair to match package.json test runner and fail-closed production behavior.";
  let strategy =
    "Re-read package.json scripts and authorized test exemplars; fix the defect shown in QC evidence; add regression coverage.";
  let avoid = "Do not invent Vitest expect narratives unsupported by QC evidence.";

  if (primary === "ESM_REQUIRE_USAGE") {
    hypothesis = "Tests or sources used require() under type:module ESM.";
    strategy = "Rewrite tests with import; never reintroduce require() in ESM packages.";
    avoid = "require() in ESM tests";
  } else if (primary === "INVALID_NODE_ASSERT_API") {
    hypothesis = "Invalid Node assert API (e.g. assert.throwsAsync).";
    strategy = "Use await assert.rejects(async () => ...) from node:assert/strict.";
    avoid = "assert.throwsAsync";
  } else if (primary === "INVALID_NODE_TEST_EXPECT") {
    hypothesis = "Imported expect from node:test (unsupported).";
    strategy = "Use import test from 'node:test'; import assert from 'node:assert/strict'.";
    avoid = "expect from node:test";
  }

  const structured: StructuredDiagnosisFields = {
    observed_failure: input.qcSummary || evidence.slice(0, 200),
    evidence_quote_or_signature: evidence.slice(0, 280),
    affected_file_or_gate: /src\/\S+/.exec(evidence)?.[0] ?? "npm test",
    root_cause_hypothesis: hypothesis,
    confidence: primary ? "high" : "medium",
    contradictory_evidence: "(none — deterministic summary from QC)",
    recommended_strategy_change: strategy,
    avoid_repeating: avoid,
  };

  return {
    advisory: true,
    failureClass: input.failureClass,
    summary: `Deterministic evidence-grounded diagnosis (${primary ?? "QC"}).`,
    failedHypothesis: input.failedHypothesis ?? "Previous change did not meet acceptance.",
    whyPreviousFailed: `${structured.observed_failure} | evidence: ${structured.evidence_quote_or_signature}`,
    suggestedStrategy: strategy,
    filesToInspect: structured.affected_file_or_gate !== "npm test" ? [structured.affected_file_or_gate] : [],
    doNotMutate: true,
    ...structured,
  };
}

export function mergeStructuredDiagnosis(
  base: DiagnosisResult,
  worker: Record<string, unknown> | null,
): DiagnosisResult {
  if (!worker) return base;
  const pick = (key: keyof StructuredDiagnosisFields): string | undefined => {
    const value = worker[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const confidenceRaw = worker.confidence;
  const confidence =
    confidenceRaw === "low" || confidenceRaw === "medium" || confidenceRaw === "high"
      ? confidenceRaw
      : base.confidence;

  return {
    ...base,
    observed_failure: pick("observed_failure") ?? base.observed_failure,
    evidence_quote_or_signature: pick("evidence_quote_or_signature") ?? base.evidence_quote_or_signature,
    affected_file_or_gate: pick("affected_file_or_gate") ?? base.affected_file_or_gate,
    root_cause_hypothesis: pick("root_cause_hypothesis") ?? base.root_cause_hypothesis,
    confidence,
    contradictory_evidence: pick("contradictory_evidence") ?? base.contradictory_evidence,
    recommended_strategy_change: pick("recommended_strategy_change") ?? base.recommended_strategy_change,
    avoid_repeating: pick("avoid_repeating") ?? base.avoid_repeating,
  };
}

export function authoritativeDiagnosisHint(document: AutonomousDocument): string[] {
  const diagnosis = document.diagnosis;
  if (!diagnosis) return [];
  if (diagnosis.authoritative === false) {
    return [
      `Non-authoritative prior diagnosis (ignored for strategy): ${diagnosis.whyPreviousFailed}`,
      `Use deterministic QC evidence instead: ${diagnosis.evidence_quote_or_signature ?? diagnosis.observed_failure ?? ""}`,
      diagnosis.suggestedStrategy ? `Fallback strategy: ${diagnosis.suggestedStrategy}` : "",
    ].filter(Boolean);
  }
  return [
    `Previous iteration failed: ${diagnosis.whyPreviousFailed}`,
    `Suggested strategy: ${diagnosis.suggestedStrategy}`,
    diagnosis.avoid_repeating ? `Avoid repeating: ${diagnosis.avoid_repeating}` : "",
    diagnosis.evidence_quote_or_signature
      ? `Evidence: ${diagnosis.evidence_quote_or_signature.slice(0, 280)}`
      : "",
    "Produce a revised worker plan that addresses the failure. Do not repeat the failed hypothesis.",
  ].filter(Boolean);
}

export function ensureFailureSignatureHistory(
  document: AutonomousDocument,
): FailureSignatureRecord[] {
  return document.failureSignatureHistory ?? [];
}
