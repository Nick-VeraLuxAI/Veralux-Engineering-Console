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
  FailureSignatureRecord,
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
  "TEST_ASSERTION_MODE_MISMATCH",
  /** Production (or non-hook) identifier referenced but not defined/imported. */
  "UNBOUND_IDENTIFIER",
  /** node:test / node:assert (or vitest) imported into non-test production sources. */
  "TEST_HARNESS_IMPORT_IN_PRODUCTION",
] as const;

export type FailureSignature = (typeof FAILURE_SIGNATURES)[number];

/** Test-runner / assertion globals — not treated as missing module imports. */
const HOOK_OR_RUNNER_GLOBALS = new Set([
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "describe",
  "it",
  "expect",
  "test",
  "vi",
  "jest",
]);

export interface UnboundIdentifierFinding {
  symbol: string;
  productionFiles: string[];
  testFiles: string[];
  /** Prefer first production stack frame; else first test frame. */
  primaryFile: string | null;
  isHookGlobal: boolean;
  evidenceQuote: string;
}

export interface DependencyNeighborhood {
  symbol: string;
  candidateModules: string[];
  hint: string;
}

export interface RepoTestGroundingFacts {
  moduleType: "module" | "commonjs" | "unknown";
  testCommand: string;
  assertionLib: "node:assert" | "vitest" | "unknown";
  runner: "node:test" | "vitest" | "unknown";
  factsBlock: string;
}

export interface SubjectCallMode {
  path: string;
  name: string;
  mode: "sync" | "async";
}

export interface TestExemplar {
  path: string;
  content: string;
  proximityScore: number;
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
/** Keep enough room for ReferenceError + stack frames past TAP location noise. */
const EVIDENCE_UNBOUND_SLICE_CHARS = 900;

function isTestPath(relative: string): boolean {
  return TEST_PATH_RE.test(relative) || relative.includes("__tests__/");
}

function normalizeEvidencePath(raw: string): string | null {
  let cleaned = raw.replace(/\\/g, "/");
  const fileUrl = cleaned.match(/file:\/\/\/?(.+\.(?:js|mjs|cjs|ts|tsx|jsx))/i);
  if (fileUrl) cleaned = fileUrl[1];
  const srcIdx = cleaned.search(/(?:^|\/)(src\/\S+\.(?:js|mjs|cjs|ts|tsx|jsx))/i);
  if (srcIdx >= 0) {
    const match = cleaned.slice(srcIdx).match(/src\/\S+\.(?:js|mjs|cjs|ts|tsx|jsx)/i);
    return match ? match[0].replace(/^\//, "") : null;
  }
  const bare = cleaned.match(/([\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx))/);
  return bare ? bare[1].replace(/^\.\//, "") : null;
}

/**
 * Parse ReferenceError / "is not defined" failures and attribute stack frames
 * to production vs test files (primary causal file prefers production).
 */
export function parseUnboundIdentifierFindings(evidenceText: string): UnboundIdentifierFinding[] {
  const text = evidenceText || "";
  if (!text) return [];
  const findings: UnboundIdentifierFinding[] = [];
  const seen = new Set<string>();

  const patterns: RegExp[] = [
    /ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/g,
    /(?:error|Error):\s*['"]([A-Za-z_$][\w$]*)\s+is not defined['"]/g,
    /\b([A-Za-z_$][\w$]*)\s+is not defined\b/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const symbol = match[1];
      if (!symbol || seen.has(symbol)) continue;
      // Skip noise tokens from prose.
      if (["Error", "TypeError", "RangeError", "undefined", "null"].includes(symbol)) continue;
      seen.add(symbol);

      const aroundStart = Math.max(0, match.index - 80);
      const aroundEnd = Math.min(text.length, match.index + 700);
      const window = text.slice(aroundStart, aroundEnd);
      const productionFiles: string[] = [];
      const testFiles: string[] = [];
      for (const frame of window.matchAll(
        /(?:at\s+\S+\s+\()?((?:file:\/\/\/?)?[^\s)]+\.(?:js|mjs|cjs|ts|tsx|jsx)):(\d+)/g,
      )) {
        const normalized = normalizeEvidencePath(frame[1]);
        if (!normalized) continue;
        if (isTestPath(normalized)) {
          if (!testFiles.includes(normalized)) testFiles.push(normalized);
        } else if (!productionFiles.includes(normalized)) {
          productionFiles.push(normalized);
        }
      }
      // TAP location lines without "at".
      for (const loc of window.matchAll(
        /(?:location|file):\s*['"]?((?:file:\/\/\/?)?[^\s'"]+\.(?:js|mjs|cjs|ts|tsx|jsx))/gi,
      )) {
        const normalized = normalizeEvidencePath(loc[1]);
        if (!normalized) continue;
        if (isTestPath(normalized)) {
          if (!testFiles.includes(normalized)) testFiles.push(normalized);
        } else if (!productionFiles.includes(normalized)) {
          productionFiles.push(normalized);
        }
      }

      findings.push({
        symbol,
        productionFiles,
        testFiles,
        primaryFile: productionFiles[0] ?? testFiles[0] ?? null,
        isHookGlobal: HOOK_OR_RUNNER_GLOBALS.has(symbol),
        evidenceQuote: window.slice(0, 280),
      });
    }
  }
  return findings;
}

/** Scan authorized production sources for uses of an unbound symbol without a local binding/import. */
export function findProductionFilesUsingUnboundSymbol(
  repoPath: string,
  prefixes: string[],
  symbol: string,
): string[] {
  const hits: string[] = [];
  const files = listAuthorizedWorktreeFiles(repoPath, prefixes, 48).filter(
    (relative) => /\.(js|mjs|cjs|ts)$/.test(relative) && !isTestPath(relative),
  );
  for (const relative of files) {
    try {
      const content = fs.readFileSync(path.join(repoPath, relative), "utf8");
      const used =
        new RegExp(String.raw`\b${symbol}\s*\.`).test(content) ||
        new RegExp(String.raw`\b${symbol}\s*\(`).test(content);
      if (!used) continue;
      const definedOrImported =
        new RegExp(String.raw`\bimport\b[^;]*\b${symbol}\b`).test(content) ||
        new RegExp(String.raw`from\s+['"][^'"]*${symbol}[^'"]*['"]`).test(content) ||
        new RegExp(String.raw`\b(?:const|let|var|function|class)\s+${symbol}\b`).test(content);
      if (!definedOrImported) hits.push(relative);
    } catch {
      // skip
    }
  }
  return hits;
}

/** Bounded sibling-module neighborhood for an unbound symbol (no hard-coded names). */
export function findSymbolDependencyNeighborhood(
  repoPath: string,
  prefixes: string[],
  symbol: string,
  options: { maxCandidates?: number } = {},
): DependencyNeighborhood {
  const maxCandidates = options.maxCandidates ?? 4;
  const candidates: string[] = [];
  const files = listAuthorizedWorktreeFiles(repoPath, prefixes, 64).filter(
    (relative) => /\.(js|mjs|cjs|ts)$/.test(relative) && !isTestPath(relative),
  );
  const lower = symbol.toLowerCase();
  for (const relative of files) {
    const base = path.basename(relative).replace(/\.(js|mjs|cjs|ts)$/, "");
    if (base.toLowerCase() === lower || base.toLowerCase().includes(lower)) {
      candidates.push(relative);
      continue;
    }
    try {
      const content = fs.readFileSync(path.join(repoPath, relative), "utf8");
      const exportsSymbol =
        new RegExp(String.raw`export\s+(?:default\s+)?(?:const|let|var|function|class)\s+${symbol}\b`).test(
          content,
        ) ||
        new RegExp(String.raw`export\s*\{[^}]*\b${symbol}\b`).test(content) ||
        (base.toLowerCase() === lower && /export\s+default\b/.test(content));
      if (exportsSymbol) candidates.push(relative);
    } catch {
      // skip
    }
    if (candidates.length >= maxCandidates) break;
  }
  const unique = [...new Set(candidates)].slice(0, maxCandidates);
  const hint =
    unique.length > 0
      ? `Unbound '${symbol}' — sibling module candidate(s): ${unique.join(", ")}. Import or wire that dependency in the production file from the stack; do not only add a test fixture.`
      : `Unbound '${symbol}' — no sibling module found; define it in the production file from the stack (or import the correct module). Do not thrash test hooks while this production ReferenceError persists.`;
  return { symbol, candidateModules: unique, hint };
}

/**
 * Prefer production UNBOUND_IDENTIFIER over hook thrash when both appear.
 * Hook-only unbound (beforeEach) still yields VITEST_HOOK_UNDER_NODE_TEST.
 */
export function prioritizeFailureSignatures(
  signatures: FailureSignature[],
  unbound: UnboundIdentifierFinding[],
): FailureSignature[] {
  const productionUnbound = unbound.filter((u) => !u.isHookGlobal);
  const ordered: FailureSignature[] = [];
  if (productionUnbound.length > 0) {
    ordered.push("UNBOUND_IDENTIFIER");
  }
  for (const sig of signatures) {
    if (sig === "UNBOUND_IDENTIFIER") continue;
    // Defer hook thrash when a production unbound identifier is the primary causal failure.
    if (sig === "VITEST_HOOK_UNDER_NODE_TEST" && productionUnbound.length > 0) continue;
    if (!ordered.includes(sig)) ordered.push(sig);
  }
  if (productionUnbound.length === 0 && signatures.includes("VITEST_HOOK_UNDER_NODE_TEST")) {
    if (!ordered.includes("VITEST_HOOK_UNDER_NODE_TEST")) ordered.push("VITEST_HOOK_UNDER_NODE_TEST");
  }
  if (productionUnbound.length > 0 && !ordered.includes("UNBOUND_IDENTIFIER")) {
    ordered.unshift("UNBOUND_IDENTIFIER");
  }
  return ordered.length > 0 ? ordered : signatures;
}

/**
 * Block test-hook rewrites when a production unbound ReferenceError is still open
 * and the plan does not touch the implicated production file / dependency.
 */
export function shouldBlockTestThrashWhileProductionUnbound(input: {
  plan: WorkerPlan;
  unbound: UnboundIdentifierFinding[];
  neighborhood?: DependencyNeighborhood | null;
  /** Extra production files known to still reference the unbound symbol. */
  productionFilesStillUnbound?: string[];
}): { block: boolean; message: string } {
  const productionHits = input.unbound.filter((u) => !u.isHookGlobal);
  if (productionHits.length === 0 && !(input.productionFilesStillUnbound?.length)) {
    return { block: false, message: "" };
  }

  const ops = input.plan.operations ?? [];
  if (ops.length === 0) return { block: false, message: "" };

  const mutated = ops.map((op) => op.path.replace(/\\/g, "/"));
  const onlyTests = mutated.every((p) => isTestPath(p));
  const touchesHooks = ops.some((op) => {
    const content = op.content ?? "";
    return (
      isTestPath(op.path) &&
      (/\bbeforeEach\b/.test(content) ||
        /\bafterEach\b/.test(content) ||
        /test\.beforeEach/.test(content) ||
        /from\s+['"]node:test['"]/.test(content))
    );
  });

  const mustTouch = new Set<string>([
    ...productionHits.flatMap((h) => h.productionFiles),
    ...(input.productionFilesStillUnbound ?? []),
  ]);
  if (mustTouch.size === 0 && productionHits[0]?.primaryFile) {
    mustTouch.add(productionHits[0].primaryFile);
  }

  const symbols = [
    ...productionHits.map((h) => h.symbol),
    ...(input.neighborhood ? [input.neighborhood.symbol] : []),
  ];
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];

  const touchesProductionFix = ops.some((op) => {
    const p = op.path.replace(/\\/g, "/");
    if (isTestPath(p)) return false;
    const content = op.content ?? "";
    const pathRelevant =
      mustTouch.size === 0 ||
      [...mustTouch].some((file) => p === file || p.endsWith(file) || file.endsWith(p));
    if (!pathRelevant && mustTouch.size > 0) return false;
    return uniqueSymbols.some(
      (sym) =>
        new RegExp(String.raw`\bimport\b[^;]*\b${sym}\b`).test(content) ||
        new RegExp(String.raw`\b(?:const|let|var|function|class)\s+${sym}\b`).test(content) ||
        new RegExp(String.raw`from\s+['"][^'"]*${sym}[^'"]*['"]`).test(content),
    );
  });

  if (onlyTests && touchesHooks && !touchesProductionFix && (mustTouch.size > 0 || uniqueSymbols.length > 0)) {
    const sym = uniqueSymbols[0] ?? productionHits[0]?.symbol ?? "identifier";
    const files = [...mustTouch].join(", ") || "(production source)";
    return {
      block: true,
      message: `TEST_THRASH_GUARD: production ReferenceError '${sym} is not defined' in ${files} is still open; do not rewrite beforeEach/test hooks until the production file imports or defines '${sym}'.`,
    };
  }
  return { block: false, message: "" };
}

export function formatUnboundDependencyHint(
  unbound: UnboundIdentifierFinding[],
  neighborhood: DependencyNeighborhood | null,
): string {
  const production = unbound.filter((u) => !u.isHookGlobal);
  if (production.length === 0) return "";
  const primary = production[0];
  const lines = [
    `Primary causal unbound identifier: '${primary.symbol}'`,
    primary.primaryFile ? `Primary file (prefer production stack): ${primary.primaryFile}` : "",
    primary.productionFiles.length
      ? `Production stack files: ${primary.productionFiles.join(", ")}`
      : "",
    neighborhood?.hint ?? "",
    "Signature-gated guidance (UNBOUND_IDENTIFIER evidence present): import or define that name in the production file first. Sibling modules under the authorized prefix may already export it — wire the import; do not only add a test fixture.",
    "Do not treat this as a missing test fixture alone when the stack points at production source.",
    "Do not rewrite beforeEach/lifecycle hooks while this production ReferenceError remains.",
  ];
  return lines.filter(Boolean).join("\n");
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
      ? [
          "Deterministic: use import test from 'node:test'; import assert from 'node:assert/strict'; never expect/describe/it from node:test; never assert.throwsAsync.",
          "Repo node:assert grounding: synchronous subjects that throw → assert.throws(() => subject(...)); Promise/async subjects → await assert.rejects(async () => subject(...)).",
          "Never use assert.rejects on a proven synchronous function (export function / non-async). That mismatch causes unhandledRejection / testCodeFailure under node:test.",
        ].join(" ")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { moduleType, testCommand, assertionLib, runner, factsBlock };
}

/** Extract sync vs async export visibility from authorized production sources (not tests). */
export function readSubjectCallModes(
  repoPath: string,
  prefixes: string[],
  options: { maxFiles?: number } = {},
): SubjectCallMode[] {
  const maxFiles = options.maxFiles ?? 8;
  const files = listAuthorizedWorktreeFiles(repoPath, prefixes, 48)
    .filter((relative) => /\.(js|mjs|cjs|ts)$/.test(relative))
    .filter((relative) => !isTestPath(relative))
    .slice(0, maxFiles);
  const modes: SubjectCallMode[] = [];
  for (const relative of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(repoPath, relative), "utf8");
    } catch {
      continue;
    }
    const asyncExports = [
      ...content.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g),
      ...content.matchAll(
        /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*(?:function|\()/g,
      ),
    ];
    const syncExports = [
      ...content.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g),
      ...content.matchAll(
        /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!async\b)(?:function|\()/g,
      ),
    ];
    const asyncNames = new Set(asyncExports.map((m) => m[1]));
    for (const match of asyncExports) {
      modes.push({ path: relative, name: match[1], mode: "async" });
    }
    for (const match of syncExports) {
      if (asyncNames.has(match[1])) continue;
      modes.push({ path: relative, name: match[1], mode: "sync" });
    }
  }
  return modes;
}

export function formatSubjectCallModeBlock(modes: SubjectCallMode[]): string {
  if (modes.length === 0) {
    return "(no exported subjects found under authorized prefixes)";
  }
  return [
    "Subject call modes (read before writing negative-path tests):",
    ...modes.map((m) => `- ${m.path} :: ${m.name} = ${m.mode}`),
    "Use assert.throws for sync; await assert.rejects only for async/Promise subjects.",
  ].join("\n");
}

/** High-confidence: assert.rejects used against a proven sync subject name. */
export function detectTestAssertionModeMismatch(
  testContent: string,
  syncSubjectNames: string[],
): boolean {
  if (!/assert\.rejects\b/.test(testContent) || syncSubjectNames.length === 0) return false;
  for (const name of syncSubjectNames) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // assert.rejects(() => syncFn(...)) or await assert.rejects(() => syncFn(...))
    // also assert.rejects(async () => syncFn(...)) when syncFn itself is sync — still wrong for throw.
    const pattern = new RegExp(
      String.raw`assert\.rejects\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*[^;]*\b${escaped}\s*\(`,
    );
    if (pattern.test(testContent)) return true;
  }
  return false;
}

/** Narrow QC-evidence detector for sync throw leaking through assert.rejects. */
export function detectAssertionModeMismatchInEvidence(evidenceText: string): boolean {
  const text = evidenceText || "";
  if (!/Function\.rejects|assert\.rejects|waitForActual/.test(text)) return false;
  // Sync throw surfaces as testCodeFailure TypeError from subject, not as a rejected Promise assertion.
  if (/failureType:\s*'testCodeFailure'|ERR_TEST_FAILURE/.test(text) && /TypeError/.test(text)) {
    return true;
  }
  if (/unhandledRejection|UnhandledPromiseRejection/.test(text) && /rejects/.test(text)) {
    return true;
  }
  return false;
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
      const unbound = parseUnboundIdentifierFindingBlocks(raw);
      if (unbound) {
        const slice = unbound.slice(0, Math.max(maxChars, EVIDENCE_UNBOUND_SLICE_CHARS));
        return `${item.identity.name} :: ${slice}`;
      }
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

/** Prefer ReferenceError blocks that include stack frames (production before TAP location-only). */
function parseUnboundIdentifierFindingBlocks(raw: string): string | null {
  if (!/is not defined|ReferenceError/i.test(raw)) return null;
  const chunks: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/is not defined|ReferenceError/i.test(lines[i])) continue;
    const block = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 12)).join("\n");
    chunks.push(block);
  }
  if (chunks.length === 0) return null;
  // Prefer blocks that mention a non-test src/ frame.
  chunks.sort((a, b) => {
    const score = (text: string) => {
      let s = 0;
      if (/src\/\S+\.(?:js|ts)/.test(text) && !/\.test\.|\.spec\./.test(text)) s += 5;
      if (/ReferenceError/.test(text)) s += 2;
      if (/beforeEach|afterEach/.test(text)) s -= 1;
      return s;
    };
    return score(b) - score(a);
  });
  return chunks.join("\n---\n");
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
  if (detectAssertionModeMismatchInEvidence(text)) {
    found.add("TEST_ASSERTION_MODE_MISMATCH");
  }

  const unbound = parseUnboundIdentifierFindings(text);
  if (unbound.some((u) => !u.isHookGlobal)) {
    found.add("UNBOUND_IDENTIFIER");
  }
  // Hook-global ReferenceError under node:test is the vitest-hook class.
  if (unbound.some((u) => u.isHookGlobal) && /node --test|node:test|ReferenceError/.test(text)) {
    found.add("VITEST_HOOK_UNDER_NODE_TEST");
  }

  return prioritizeFailureSignatures([...found], unbound);
}

export function detectFailureSignaturesInPlan(
  plan: WorkerPlan,
  facts: RepoTestGroundingFacts,
  syncSubjectNames: string[] = [],
): FailureSignature[] {
  const found = new Set<FailureSignature>();
  const planSyncNames = new Set(syncSubjectNames);
  for (const op of plan.operations ?? []) {
    if (!/\.(js|ts|mjs|cjs)$/.test(op.path) || isTestPath(op.path)) continue;
    if (op.type === "delete_file") continue;
    const content = op.content ?? "";
    for (const match of content.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      planSyncNames.add(match[1]);
    }
    for (const match of content.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      planSyncNames.delete(match[1]);
    }
  }
  const syncNames = [...planSyncNames];
  for (const op of plan.operations ?? []) {
    if (!isTestPath(op.path) && !/\.(js|ts|mjs|cjs)$/.test(op.path)) continue;
    const content = op.content ?? "";
    for (const sig of detectHarnessSignaturesInContent(op.path, content, facts, syncNames)) {
      found.add(sig.signature);
    }
  }
  return [...found];
}

export function detectHarnessSignaturesInContent(
  filePath: string,
  content: string,
  facts: RepoTestGroundingFacts,
  syncSubjectNames: string[] = [],
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
  if (isTest && detectTestAssertionModeMismatch(content, syncSubjectNames)) {
    findings.push({
      path: filePath,
      signature: "TEST_ASSERTION_MODE_MISMATCH",
      message: `${filePath}: assert.rejects used on a proven synchronous subject; use assert.throws(() => ...) for sync throws.`,
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
  // Production/test boundary: never import test harness / assert libraries into production modules.
  if (
    !isTest &&
    /\.(js|mjs|cjs|ts|tsx)$/.test(filePath) &&
    /from\s+['"](?:node:assert(?:\/strict)?|node:test|vitest|@jest\/globals)['"]/.test(content)
  ) {
    findings.push({
      path: filePath,
      signature: "TEST_HARNESS_IMPORT_IN_PRODUCTION",
      message: `${filePath}: test harness / assert imports are forbidden in production sources; keep node:assert and node:test in *.test.* / *.spec.* files only.`,
    });
  }
  return findings;
}

/**
 * Detect escaped-newline corruption after JSON decode.
 * Reject:
 * - whole-file single physical line where `\\n` separates statements
 * - mixed corruption where literal `\\n` still separates multiple statements
 *   even if a few real newlines are also present (prior slip path)
 * Allow: real newlines as primary structure; legitimate string escapes like `"hello\\nworld"`.
 */
export function hasLiteralEscapedNewlineCorruption(content: string): boolean {
  if (!content || content.length < 40) return false;
  if (!content.includes("\\n")) return false;

  const STATEMENT_START =
    /^\s*(?:import\s|export\s|const\s|let\s|var\s|function\s|class\s|return\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|await\s|async\s|type\s|interface\s|describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert\.|}|{\s*$)/;

  const statementyParts = (parts: string[]) =>
    parts.filter((part) => {
      const trimmed = part.trim();
      if (!trimmed) return false;
      return STATEMENT_START.test(trimmed) || /;\s*$/.test(trimmed);
    }).length;

  const realNewlineCount = (content.match(/\r?\n/g) ?? []).length;
  const literalCount = content.split("\\n").length - 1;

  // Whole-file case: no real newlines; multiple statement-separating \\n.
  if (realNewlineCount === 0) {
    const parts = content.split("\\n");
    if (parts.length < 3) {
      // One or two escapes — typically a legitimate string escape on a one-liner.
      return false;
    }
    return statementyParts(parts) >= 2;
  }

  // Mixed corruption: many literal \\n statement separators vs few real newlines.
  // Catches plans that slipped when a single real newline made the old detector return false.
  if (literalCount >= 3 && literalCount >= realNewlineCount + 2) {
    const parts = content.split("\\n");
    if (statementyParts(parts) >= 2) return true;
  }
  return false;
}

/** Minimal deterministic harness guards on plan operations (WP6). */
export function validatePlanHarnessGuards(
  plan: WorkerPlan,
  facts: RepoTestGroundingFacts,
  syncSubjectNames: string[] = [],
): HarnessGuardFinding[] {
  const planSyncNames = new Set(syncSubjectNames);
  for (const op of plan.operations ?? []) {
    if (!/\.(js|ts|mjs|cjs)$/.test(op.path) || isTestPath(op.path) || op.type === "delete_file") continue;
    const content = op.content ?? "";
    for (const match of content.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      planSyncNames.add(match[1]);
    }
    for (const match of content.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      planSyncNames.delete(match[1]);
    }
  }
  const syncNames = [...planSyncNames];
  const findings: HarnessGuardFinding[] = [];
  for (const op of plan.operations ?? []) {
    findings.push(...detectHarnessSignaturesInContent(op.path, op.content ?? "", facts, syncNames));
  }
  return findings;
}

/** Fast pre-QC on changed test files in the worktree (WP7). */
export function validateChangedTestHarness(
  repoPath: string,
  changedFiles: string[],
  facts: RepoTestGroundingFacts,
  syncSubjectNames: string[] = [],
): HarnessGuardFinding[] {
  const findings: HarnessGuardFinding[] = [];
  const syncNames =
    syncSubjectNames.length > 0
      ? syncSubjectNames
      : readSubjectCallModes(repoPath, ["src/"])
          .filter((m) => m.mode === "sync")
          .map((m) => m.name);
  for (const relative of changedFiles.filter(isTestPath)) {
    const absolute = path.join(repoPath, relative);
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      const content = fs.readFileSync(absolute, "utf8");
      findings.push(...detectHarnessSignaturesInContent(relative, content, facts, syncNames));
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
  dependencyNeighborhood?: DependencyNeighborhood | null;
}): DiagnosisResult & StructuredDiagnosisFields {
  const evidence = input.evidenceText.slice(0, EVIDENCE_UNBOUND_SLICE_CHARS) || input.qcSummary || "QC failed";
  const unbound = parseUnboundIdentifierFindings(input.evidenceText || evidence);
  const signatures = prioritizeFailureSignatures(
    input.signatures?.length ? input.signatures : detectFailureSignaturesInText(evidence),
    unbound,
  );
  const primary = signatures[0];
  const productionUnbound = unbound.find((u) => !u.isHookGlobal);

  let hypothesis = "Owned QC failure; repair to match package.json test runner and fail-closed production behavior.";
  let strategy =
    "Re-read package.json scripts and authorized test exemplars; fix the defect shown in QC evidence; add regression coverage.";
  let avoid = "Do not invent Vitest expect narratives unsupported by QC evidence.";
  let affected = /src\/\S+\.(?:js|mjs|cjs|ts|tsx|jsx)/.exec(evidence)?.[0] ?? "npm test";
  // Prefer production stack file over first TAP test location.
  if (productionUnbound?.primaryFile) {
    affected = productionUnbound.primaryFile;
  }

  if (primary === "UNBOUND_IDENTIFIER" && productionUnbound) {
    const neigh = input.dependencyNeighborhood;
    hypothesis = `Unbound identifier '${productionUnbound.symbol}' referenced in ${productionUnbound.primaryFile ?? "production source"} without a local definition or import.`;
    strategy = [
      `Wire '${productionUnbound.symbol}' in the production file from the stack (${productionUnbound.productionFiles.join(", ") || productionUnbound.primaryFile || "src/…"}): import the sibling module or define it locally.`,
      neigh?.candidateModules.length
        ? `Likely dependency neighborhood: ${neigh.candidateModules.join(", ")}.`
        : "Search authorized sibling modules for an export matching the unbound symbol.",
      "Do not only add a test fixture/mock. Do not rewrite beforeEach/test lifecycle hooks until the production ReferenceError is closed.",
    ].join(" ");
    avoid = `Do not thrash test hooks or add test-only fixtures while '${productionUnbound.symbol}' remains unbound in production`;
  } else if (primary === "ESM_REQUIRE_USAGE") {
    hypothesis = "Tests or sources used require() under type:module ESM.";
    strategy = "Rewrite tests with import; never reintroduce require() in ESM packages.";
    avoid = "require() in ESM tests";
  } else if (primary === "TEST_ASSERTION_MODE_MISMATCH") {
    hypothesis =
      "Negative-path tests used assert.rejects against a synchronous subject that throws (sync-vs-async assertion mismatch).";
    strategy =
      "For sync subjects use assert.throws(() => subject(...)); reserve await assert.rejects(async () => ...) for async/Promise subjects only.";
    avoid = "assert.rejects on proven sync functions";
  } else if (primary === "INVALID_NODE_ASSERT_API") {
    hypothesis = "Invalid Node assert API (e.g. assert.throwsAsync).";
    strategy = "Use await assert.rejects(async () => ...) from node:assert/strict for async subjects; assert.throws for sync.";
    avoid = "assert.throwsAsync";
  } else if (primary === "INVALID_NODE_TEST_EXPECT") {
    hypothesis = "Imported expect from node:test (unsupported).";
    strategy = "Use import test from 'node:test'; import assert from 'node:assert/strict'.";
    avoid = "expect from node:test";
  } else if (primary === "VITEST_HOOK_UNDER_NODE_TEST") {
    hypothesis = "Test used Vitest/Jest lifecycle globals under node:test without proper imports.";
    strategy =
      "Use import test from 'node:test' and test.beforeEach / test.afterEach (or drop hooks). Prefer fixing production ReferenceErrors first when stacks point at src non-test files.";
    avoid = "bare beforeEach/afterEach under node --test";
  }

  const structured: StructuredDiagnosisFields = {
    observed_failure:
      productionUnbound && primary === "UNBOUND_IDENTIFIER"
        ? `ReferenceError: ${productionUnbound.symbol} is not defined`
        : input.qcSummary || evidence.slice(0, 200),
    evidence_quote_or_signature:
      productionUnbound?.evidenceQuote?.slice(0, 280) || evidence.slice(0, 280),
    affected_file_or_gate: affected,
    root_cause_hypothesis: hypothesis,
    confidence: primary ? "high" : "medium",
    contradictory_evidence: "(none — deterministic summary from QC)",
    recommended_strategy_change: strategy,
    avoid_repeating: avoid,
  };

  const filesToInspect = [
    ...(structured.affected_file_or_gate !== "npm test" ? [structured.affected_file_or_gate] : []),
    ...(productionUnbound?.productionFiles ?? []),
    ...(input.dependencyNeighborhood?.candidateModules ?? []),
  ];

  return {
    advisory: true,
    failureClass: input.failureClass,
    summary: `Deterministic evidence-grounded diagnosis (${primary ?? "QC"}).`,
    failedHypothesis: input.failedHypothesis ?? "Previous change did not meet acceptance.",
    whyPreviousFailed: `${structured.observed_failure} | evidence: ${structured.evidence_quote_or_signature}`,
    suggestedStrategy: strategy,
    filesToInspect: [...new Set(filesToInspect)].slice(0, 12),
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

export function formatSeniorHardConstraintBlock(document: AutonomousDocument): string[] {
  const constraint = document.scaffoldGuard?.seniorHardConstraint;
  if (!constraint?.nextWorkerMission) return [];
  const lines = [
    "HARD CONSTRAINT (senior review — mandatory for this replan; do not contradict):",
    constraint.nextWorkerMission,
  ];
  if (document.scaffoldGuard?.contractsFrozen) {
    lines.push(
      "src/contracts.ts is FROZEN after repeated contract regressions — do not plan update_file, append_file, or delete_file on contracts.ts; add types in new modules or skip contract edits.",
    );
  }
  if (document.scaffoldGuard?.integrationCrib) {
    lines.push("Integration API crib (senior + specimen):", document.scaffoldGuard.integrationCrib);
  }
  if (constraint.rootCause) {
    lines.push(`Senior root cause: ${constraint.rootCause}`);
  }
  return lines;
}

export function authoritativeDiagnosisHint(document: AutonomousDocument): string[] {
  const seniorHard = formatSeniorHardConstraintBlock(document);
  const diagnosis = document.diagnosis;
  if (!diagnosis) return seniorHard;
  if (diagnosis.authoritative === false) {
    return [
      ...seniorHard,
      `Non-authoritative prior diagnosis (ignored for strategy): ${diagnosis.whyPreviousFailed}`,
      `Use deterministic QC evidence instead: ${diagnosis.evidence_quote_or_signature ?? diagnosis.observed_failure ?? ""}`,
      diagnosis.suggestedStrategy ? `Fallback strategy: ${diagnosis.suggestedStrategy}` : "",
    ].filter(Boolean);
  }
  const strategyLine = seniorHard.length > 0
    ? `Worker strategy (senior overrides when HARD CONSTRAINT present): ${diagnosis.suggestedStrategy}`
    : `Suggested strategy: ${diagnosis.suggestedStrategy}`;
  return [
    ...seniorHard,
    `Previous iteration failed: ${diagnosis.whyPreviousFailed}`,
    strategyLine,
    diagnosis.avoid_repeating ? `Avoid repeating: ${diagnosis.avoid_repeating}` : "",
    diagnosis.evidence_quote_or_signature
      ? `Evidence: ${diagnosis.evidence_quote_or_signature.slice(0, 280)}`
      : "",
    seniorHard.length === 0
      ? "Produce a revised worker plan that addresses the failure. Do not repeat the failed hypothesis."
      : "Produce a worker plan that satisfies the HARD CONSTRAINT above. Do not repeat failed contract rewrites.",
  ].filter(Boolean);
}

export function ensureFailureSignatureHistory(
  document: AutonomousDocument,
): FailureSignatureRecord[] {
  return document.failureSignatureHistory ?? [];
}
