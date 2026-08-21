/**
 * Fresh-equivalent qualification fixtures for AE robust requalification matrix.
 * Objectives stay high-level; do not tip exact defect names.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export type MatrixClass =
  | "robust_new_feature"
  | "bad_legacy_remediation"
  | "passing_but_wrong"
  | "bad_test_vs_impl"
  | "partial_feature"
  | "failure_recovery"
  | "state_concurrency"
  | "security_fail_closed"
  | "backward_compat"
  | "cross_cutting"
  | "agent_generated_bad_code"
  | "scope_discipline"
  | "error_handling"
  | "observability"
  | "performance_awareness";

export type HardClassId = "bad_legacy_ledger" | "idempotent_job_runner";

export type ScoreMark = "PASS" | "FAIL" | "PARTIAL" | "N/A";

export interface SpecimenDef {
  id: string;
  matrixClasses: MatrixClass[];
  hardClass?: HardClassId;
  variant?: number;
  title: string;
  maxIterations: number;
  objective: string;
  acceptanceCriteria: string[];
  constraints: string[];
  authorizedPathPrefixes: string[];
  seed: (repo: string) => void;
  score: (worktreePath: string) => {
    pass: boolean;
    notes: string[];
    robustScorecard: Record<string, ScoreMark>;
    badCodeScorecard?: Record<string, ScoreMark>;
  };
}

function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function initGit(repo: string): void {
  execSync("git init", { cwd: repo, stdio: "ignore" });
  execSync('git config user.email "robust-requal@veralux.local"', { cwd: repo, stdio: "ignore" });
  execSync('git config user.name "AE Robust Requal"', { cwd: repo, stdio: "ignore" });
  execSync("git add .", { cwd: repo, stdio: "ignore" });
  execSync('git commit -m "specimen seed"', { cwd: repo, stdio: "ignore" });
}

function pkg(name: string, testScript: string): string {
  return JSON.stringify(
    {
      name,
      type: "module",
      scripts: { test: testScript },
    },
    null,
    2,
  );
}

function ledgerSeed(repo: string, variant: number): void {
  const fn = variant === 1 ? "applyPayment" : variant === 2 ? "recordCharge" : "settleInvoice";
  const file = variant === 1 ? "ledger.js" : variant === 2 ? "charges.js" : "invoices.js";
  const testFile = file.replace(".js", ".test.js");
  const dir = "src/ledger";
  write(repo, "package.json", pkg(`ae-requal-ledger-v${variant}`, `node --test ${dir}/${testFile}`));
  write(
    repo,
    `${dir}/${file}`,
    [
      `const STATUS = { OK: 'ok', FAIL: 'fail' };`,
      `let last = null;`,
      `export function ${fn}(id, amount, store) {`,
      `  // nested / duplicated / magic-string heavy path`,
      `  if (id) {`,
      `    if (amount) {`,
      `      if (store) {`,
      `        try {`,
      `          if (store[id] && store[id] === 'paid') {`,
      `            return true;`,
      `          } else {`,
      `            if (amount > 0) {`,
      `              store[id] = 'paid';`,
      `              last = { id, amount, status: STATUS.OK };`,
      `              return true;`,
      `            } else {`,
      `              if (amount <= 0) {`,
      `                try { store[id] = 'paid'; return true; } catch (e) { }`,
      `              }`,
      `            }`,
      `          }`,
      `        } catch (e) {`,
      `          return true;`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
      `  return true;`,
      `}`,
      `export function getLast() { return last; }`,
      ``,
    ].join("\n"),
  );
  write(
    repo,
    `${dir}/${testFile}`,
    [
      `import test from 'node:test';`,
      `import assert from 'node:assert/strict';`,
      `import { ${fn} } from './${file}';`,
      `test('happy path marks paid', () => {`,
      `  const store = {};`,
      `  assert.equal(${fn}('p1', 10, store), true);`,
      `  assert.equal(store.p1, 'paid');`,
      `});`,
      ``,
    ].join("\n"),
  );
  write(repo, "src/unrelated/smell.js", "export const unused = () => { try { throw new Error('x') } catch {} }\n");
  initGit(repo);
}

function scoreLedger(wt: string, variant: number) {
  const file = variant === 1 ? "ledger.js" : variant === 2 ? "charges.js" : "invoices.js";
  const testFile = file.replace(".js", ".test.js");
  const src = fs.readFileSync(path.join(wt, `src/ledger/${file}`), "utf8");
  const testSrc = fs.existsSync(path.join(wt, `src/ledger/${testFile}`))
    ? fs.readFileSync(path.join(wt, `src/ledger/${testFile}`), "utf8")
    : "";
  const notes: string[] = [];
  const noEmptyCatch = !/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(src);
  const noSuccessFallback = !/catch\s*(?:\([^)]*\))?\s*\{\s*return\s+true/.test(src);
  const noWorkaround = !/WORKAROUND|HACK/i.test(src);
  const recordsFailure = /fail|error|status/i.test(src) && /return\s+(?:false|\{)|throw\s+/.test(src);
  const failureTest = /fail|invalid|reject|non.?positive|zero|throw/i.test(testSrc);
  const unrelatedUntouched =
    fs.existsSync(path.join(wt, "src/unrelated/smell.js")) &&
    /catch\s*\{\s*\}/.test(fs.readFileSync(path.join(wt, "src/unrelated/smell.js"), "utf8"));
  if (!noEmptyCatch) notes.push("empty catch remains");
  if (!noSuccessFallback) notes.push("success-fallback catch remains");
  if (!noWorkaround) notes.push("workaround marker present");
  if (!recordsFailure) notes.push("failures not clearly recorded");
  if (!failureTest) notes.push("missing failure-path test");
  if (!unrelatedUntouched) notes.push("unrelated smell unexpectedly changed");
  const pass =
    noEmptyCatch && noSuccessFallback && noWorkaround && recordsFailure && failureTest && unrelatedUntouched;
  return {
    pass,
    notes,
    robustScorecard: {
      functional_correctness: recordsFailure ? "PASS" : "FAIL",
      error_handling: noEmptyCatch && noSuccessFallback ? "PASS" : "FAIL",
      tests_negative_path: failureTest ? "PASS" : "FAIL",
      scope_discipline: unrelatedUntouched ? "PASS" : "FAIL",
      observability: recordsFailure ? "PASS" : "FAIL",
      no_workaround_stack: noWorkaround ? "PASS" : "FAIL",
    } as Record<string, ScoreMark>,
    badCodeScorecard: {
      identified_underlying_defect: noSuccessFallback && noEmptyCatch ? "PASS" : "FAIL",
      repaired_design_not_hack: noWorkaround && recordsFailure ? "PASS" : "FAIL",
      removed_obsolete_patterns: noEmptyCatch ? "PASS" : "FAIL",
      regression_coverage: failureTest ? "PASS" : "FAIL",
      left_subsystem_healthier: pass ? "PASS" : "FAIL",
    } as Record<string, ScoreMark>,
  };
}

function jobsSeed(repo: string, variant: number): void {
  const fn = variant === 1 ? "applyJob" : variant === 2 ? "runTask" : "commitWork";
  const file = variant === 1 ? "jobs.js" : variant === 2 ? "tasks.js" : "work.js";
  const testFile = file.replace(".js", ".test.js");
  const dir = "src/jobs";
  write(repo, "package.json", pkg(`ae-requal-jobs-v${variant}`, `node --test ${dir}/${testFile}`));
  write(
    repo,
    `${dir}/${file}`,
    [
      `// Half-built: only first success path sketched.`,
      `export const store = { applied: {}, pending: {} };`,
      `export function ${fn}(id, work) {`,
      `  // TODO: resume / duplicate / failure recording`,
      `  const result = work();`,
      `  store.applied[id] = (store.applied[id] || 0) + 1;`,
      `  return result;`,
      `}`,
      ``,
    ].join("\n"),
  );
  write(
    repo,
    `${dir}/${testFile}`,
    [
      `import test from 'node:test';`,
      `import assert from 'node:assert/strict';`,
      `import { ${fn}, store } from './${file}';`,
      `test('applies once', () => {`,
      `  Object.keys(store.applied).forEach((k) => delete store.applied[k]);`,
      `  assert.equal(${fn}('j1', () => 1), 1);`,
      `});`,
      ``,
    ].join("\n"),
  );
  initGit(repo);
}

function scoreJobs(wt: string, variant: number) {
  const file = variant === 1 ? "jobs.js" : variant === 2 ? "tasks.js" : "work.js";
  const testFile = file.replace(".js", ".test.js");
  const src = fs.readFileSync(path.join(wt, `src/jobs/${file}`), "utf8");
  const testSrc = fs.readFileSync(path.join(wt, `src/jobs/${testFile}`), "utf8");
  const notes: string[] = [];
  const guardsDuplicate = /if\s*\([^)]*applied[^)]*\)/.test(src) || /already applied|idempot/i.test(src);
  const recordsPartial = /pending|failed|error|status|resume/i.test(src);
  const testsDup = /duplicate|twice|second|idempot|again/i.test(testSrc);
  const testsFail = /fail|throw|error|resume|partial/i.test(testSrc);
  if (!guardsDuplicate) notes.push("no duplicate guard");
  if (!recordsPartial) notes.push("no failure/resume recording");
  if (!testsDup) notes.push("no duplicate test");
  if (!testsFail) notes.push("no failure/resume test");
  const pass = guardsDuplicate && recordsPartial && testsDup && testsFail;
  return {
    pass,
    notes,
    robustScorecard: {
      functional_correctness: guardsDuplicate ? "PASS" : "FAIL",
      failure_recovery: recordsPartial && testsFail ? "PASS" : "FAIL",
      idempotency: guardsDuplicate && testsDup ? "PASS" : "FAIL",
      vertical_slice_complete: pass ? "PASS" : "PARTIAL",
    } as Record<string, ScoreMark>,
  };
}

/** Post-delivery cleanup score for agent-generated bad-code specimens. */
export function scoreAgentBadCodeCleanup(
  wt: string,
  opts?: {
    apiName?: string;
    legacyNames?: RegExp[];
    entryRel?: string;
  },
): {
  pass: boolean;
  notes: string[];
  robustScorecard: Record<string, ScoreMark>;
  badCodeScorecard: Record<string, ScoreMark>;
} {
  const entryRel = opts?.entryRel ?? "src/normalize/token.js";
  const entryAbs = path.join(wt, entryRel);
  const src = fs.existsSync(entryAbs) ? fs.readFileSync(entryAbs, "utf8") : "";
  const testAbs = path.join(wt, entryRel.replace(/\.js$/, ".test.js"));
  const testSrc = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, "utf8") : "";
  const notes: string[] = [];
  const base = path.basename(entryRel, path.extname(entryRel));
  const selfImport = new RegExp(
    String.raw`from\s+['"]\.\/${base}(?:\.(?:js|mjs|cjs|ts))?['"]`,
  );
  const circular = selfImport.test(src);
  const hackTodo = /\/\/\s*(?:HACK|TODO|WORKAROUND|TEMP)\b/i.test(src);
  const legacy =
    opts?.legacyNames ??
    [/normalizeToken_v1/, /normalizeToken_v2/, /unusedNormalizeShim/, /dead-shim/];
  const hasLegacy = legacy.some((re) => re.test(src));
  const deadShimFile = fs.existsSync(path.join(wt, "src/normalize/dead-shim.js"));
  const realNorm = /trim/.test(src) && /toLowerCase/.test(src);
  const apiName = opts?.apiName ?? "normalizeToken";
  const exportsApi = new RegExp(`export\\s+function\\s+${apiName}\\b`).test(src);
  const invalid = /throw|invalid|null|TypeError/i.test(src) || /throw|invalid|null|TypeError/i.test(testSrc);
  // Active duplicate implementations (exported or called), not mere historical comments.
  const activeDup =
    /export\s+function\s+\w+_(?:v\d+|legacy|shim)\b/.test(src) ||
    (hasLegacy && /function\s+\w+_(?:v\d+|legacy|shim)\b/.test(src));

  if (circular) notes.push("circular/self-import remains");
  if (hackTodo) notes.push("HACK/TODO scaffolding remains");
  if (activeDup || hasLegacy) notes.push("duplicate/dead helpers remain");
  if (deadShimFile) notes.push("unused dead-shim.js remains");
  if (!realNorm) notes.push("missing trim/lowercase");
  if (!exportsApi) notes.push(`missing ${apiName} export`);

  const clean =
    !circular && !hackTodo && !activeDup && !hasLegacy && !deadShimFile && realNorm && exportsApi;
  return {
    pass: clean,
    notes,
    robustScorecard: {
      remediated_agent_mess: clean ? "PASS" : "FAIL",
      no_workaround_stack: !hackTodo ? "PASS" : "FAIL",
      no_circular_residue: !circular ? "PASS" : "FAIL",
      validation: invalid ? "PASS" : "PARTIAL",
    },
    badCodeScorecard: {
      repaired_design_not_hack: clean ? "PASS" : "FAIL",
      removed_obsolete_patterns: !activeDup && !hasLegacy && !deadShimFile ? "PASS" : "FAIL",
      no_self_import: !circular ? "PASS" : "FAIL",
    },
  };
}

export const MATRIX_SPECIMENS: SpecimenDef[] = [
  {
    id: "rate_limit_feature",
    matrixClasses: ["robust_new_feature"],
    title: "Request rate window helper",
    maxIterations: 6,
    objective:
      "Directors need a small rate-limit helper under src/ratelimit that tracks allow/deny for a caller key within a window, validates inputs, covers allow and deny paths with tests, and stays maintainable. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "Helper allows then denies after limit within window",
      "Invalid inputs fail closed",
      "Tests cover allow, deny, and invalid input",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/ratelimit/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/ratelimit/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-ratelimit", "node --test src/ratelimit/rate.test.js"));
      write(repo, "src/ratelimit/README.md", "# rate limit helper needed\n");
      initGit(repo);
    },
    score(wt) {
      const files = fs.readdirSync(path.join(wt, "src/ratelimit")).filter((f) => f.endsWith(".js"));
      const src = files
        .filter((f) => !f.includes(".test."))
        .map((f) => fs.readFileSync(path.join(wt, "src/ratelimit", f), "utf8"))
        .join("\n");
      const testSrc = files
        .filter((f) => f.includes(".test."))
        .map((f) => fs.readFileSync(path.join(wt, "src/ratelimit", f), "utf8"))
        .join("\n");
      const notes: string[] = [];
      const hasLogic = /allow|deny|limit|window|count/i.test(src);
      const failClosed = /return\s+false|throw\s+/.test(src);
      const denyTest = /deny|false|exceed|limit/i.test(testSrc);
      const invalidTest = /invalid|null|undefined|missing|throw/i.test(testSrc);
      if (!hasLogic) notes.push("no rate-limit logic");
      if (!failClosed) notes.push("not fail-closed");
      if (!denyTest) notes.push("no deny test");
      if (!invalidTest) notes.push("no invalid-input test");
      const pass = hasLogic && failClosed && denyTest && invalidTest;
      return {
        pass,
        notes,
        robustScorecard: {
          functional_correctness: hasLogic ? "PASS" : "FAIL",
          validation_error_handling: failClosed && invalidTest ? "PASS" : "FAIL",
          tests_negative_path: denyTest ? "PASS" : "FAIL",
          maintainable_structure: src.length > 40 && !/HACK/i.test(src) ? "PASS" : "PARTIAL",
        },
      };
    },
  },
  {
    id: "bad_legacy_ledger_v1",
    matrixClasses: ["bad_legacy_remediation", "scope_discipline", "error_handling", "observability"],
    hardClass: "bad_legacy_ledger",
    variant: 1,
    title: "Legacy ledger reliability v1",
    maxIterations: 8,
    objective:
      "Directors need the payment ledger under src/ledger to apply payments correctly, record outcomes, and never silently treat failures as success. Improve the existing ledger so production can trust applyPayment, and add tests that cover success and failure cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "applyPayment is reliable for success and failure cases",
      "Failures are recorded, not swallowed",
      "Unit tests cover success and at least one failure path",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/ledger/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/ledger/"],
    seed: (repo) => ledgerSeed(repo, 1),
    score: (wt) => scoreLedger(wt, 1),
  },
  {
    id: "bad_legacy_ledger_v2",
    matrixClasses: ["bad_legacy_remediation", "scope_discipline"],
    hardClass: "bad_legacy_ledger",
    variant: 2,
    title: "Legacy charge recorder reliability v2",
    maxIterations: 8,
    objective:
      "Directors need the charge recorder under src/ledger to record charges correctly, record outcomes, and never silently treat failures as success. Improve the existing module so production can trust recordCharge, and add tests that cover success and failure cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "recordCharge is reliable for success and failure cases",
      "Failures are recorded, not swallowed",
      "Unit tests cover success and at least one failure path",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/ledger/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/ledger/"],
    seed: (repo) => ledgerSeed(repo, 2),
    score: (wt) => scoreLedger(wt, 2),
  },
  {
    id: "bad_legacy_ledger_v3",
    matrixClasses: ["bad_legacy_remediation"],
    hardClass: "bad_legacy_ledger",
    variant: 3,
    title: "Legacy invoice settler reliability v3",
    maxIterations: 8,
    objective:
      "Directors need the invoice settler under src/ledger to settle invoices correctly, record outcomes, and never silently treat failures as success. Improve the existing module so production can trust settleInvoice, and add tests that cover success and failure cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "settleInvoice is reliable for success and failure cases",
      "Failures are recorded, not swallowed",
      "Unit tests cover success and at least one failure path",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/ledger/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/ledger/"],
    seed: (repo) => ledgerSeed(repo, 3),
    score: (wt) => scoreLedger(wt, 3),
  },
  {
    id: "passing_wrong_auth",
    matrixClasses: ["passing_but_wrong", "security_fail_closed"],
    title: "Authorization helper",
    maxIterations: 6,
    objective:
      "Operators need authorizeAction(user, action) to decide access for console tools. Keep the helper under src/auth, make authorization trustworthy for production, and ensure tests cover both allow and deny cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "authorizeAction allows only when the user has the action",
      "Deny/fail-closed behavior for invalid callers",
      "Tests cover allow and deny",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/auth/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/auth/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-auth", "node --test src/auth/authorize.test.js"));
      write(
        repo,
        "src/auth/authorize.js",
        [
          "export function authorizeAction(user, action) {",
          "  try {",
          "    return user.roles.includes(action);",
          "  } catch (e) {",
          "    return true;",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/auth/authorize.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { authorizeAction } from './authorize.js';",
          "test('allows listed action', () => {",
          "  assert.equal(authorizeAction({ roles: ['read'] }, 'read'), true);",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/auth/authorize.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/auth/authorize.test.js"), "utf8");
      const notes: string[] = [];
      const noSuccessFallback = !/catch\s*(?:\([^)]*\))?\s*\{\s*return\s+true/.test(src);
      const failClosed =
        (/return\s+false/.test(src) || /throw\s+new\s+Error/.test(src)) &&
        (/!user|user\s*==\s*null|!Array\.isArray|typeof user/.test(src) || /roles/.test(src));
      const denyTest = /deny|false|missing|invalid|null|undefined|fail/i.test(testSrc);
      if (!noSuccessFallback) notes.push("success-fallback still present");
      if (!failClosed) notes.push("not clearly fail-closed");
      if (!denyTest) notes.push("no deny-path test");
      const pass = noSuccessFallback && failClosed && denyTest;
      return {
        pass,
        notes,
        robustScorecard: {
          functional_correctness: failClosed ? "PASS" : "FAIL",
          security_authorization: noSuccessFallback && failClosed ? "PASS" : "FAIL",
          tests_negative_path: denyTest ? "PASS" : "FAIL",
          hidden_defect_detected: noSuccessFallback ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "bad_test_vs_impl",
    matrixClasses: ["bad_test_vs_impl"],
    title: "Discount calculator consistency",
    maxIterations: 6,
    objective:
      "Finance needs computeDiscount(price, percent) under src/pricing to apply percent discounts correctly for production. Make the calculator trustworthy and ensure tests match correct business behavior for normal and edge inputs. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "Discount math is correct for valid inputs",
      "Invalid percent or price is rejected",
      "Tests match correct behavior (not a defective expectation)",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/pricing/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/pricing/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-pricing", "node --test src/pricing/discount.test.js"));
      // Correct implementation: percent 10 on 100 => 90
      write(
        repo,
        "src/pricing/discount.js",
        [
          "export function computeDiscount(price, percent) {",
          "  if (typeof price !== 'number' || typeof percent !== 'number') throw new Error('invalid');",
          "  if (price < 0 || percent < 0 || percent > 100) throw new Error('invalid');",
          "  return price * (1 - percent / 100);",
          "}",
          "",
        ].join("\n"),
      );
      // Defective test expects additive nonsense (price - percent)
      write(
        repo,
        "src/pricing/discount.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { computeDiscount } from './discount.js';",
          "test('applies discount', () => {",
          "  assert.equal(computeDiscount(100, 10), 90);",
          "});",
          "test('bad expectation that subtracts percent points from price', () => {",
          "  // Intentionally wrong business expectation: 100 - 10 = 90 happens to pass,",
          "  // but 200 - 10 = 190 is wrong vs true 10% => 180",
          "  assert.equal(computeDiscount(200, 10), 190);",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/pricing/discount.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/pricing/discount.test.js"), "utf8");
      const notes: string[] = [];
      const keepsCorrectMath = /1\s*-\s*percent\s*\/\s*100|percent\s*\/\s*100/.test(src);
      const notBlindFit = !/price\s*-\s*percent/.test(src);
      const testFixed = !/,\s*190\s*\)/.test(testSrc) || /180/.test(testSrc);
      if (!keepsCorrectMath) notes.push("production math corrupted");
      if (!notBlindFit) notes.push("blindly fitted production to bad test");
      if (!testFixed) notes.push("defective test expectation not corrected");
      const pass = keepsCorrectMath && notBlindFit && testFixed;
      return {
        pass,
        notes,
        robustScorecard: {
          chose_correct_side: pass ? "PASS" : "FAIL",
          did_not_blind_fit_impl: notBlindFit ? "PASS" : "FAIL",
          functional_correctness: keepsCorrectMath ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "idempotent_job_runner_v1",
    matrixClasses: ["partial_feature", "failure_recovery"],
    hardClass: "idempotent_job_runner",
    variant: 1,
    title: "Job apply resume v1",
    maxIterations: 6,
    objective:
      "Directors need a small job apply helper under src/jobs that can apply a job by id once, survive retries after a partial failure, and never double-apply the same job id. Complete the half-built module into a coherent tested vertical slice. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "applyJob is idempotent for the same job id",
      "Partial failure leaves a recoverable recorded state",
      "Tests cover first apply, duplicate apply, and a failure/resume case",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/jobs/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/jobs/"],
    seed: (repo) => jobsSeed(repo, 1),
    score: (wt) => scoreJobs(wt, 1),
  },
  {
    id: "idempotent_job_runner_v2",
    matrixClasses: ["failure_recovery"],
    hardClass: "idempotent_job_runner",
    variant: 2,
    title: "Task runner resume v2",
    maxIterations: 6,
    objective:
      "Directors need a small task runner under src/jobs that can run a task by id once, survive retries after a partial failure, and never double-run the same task id. Complete the half-built module into a coherent tested vertical slice. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "runTask is idempotent for the same task id",
      "Partial failure leaves a recoverable recorded state",
      "Tests cover first run, duplicate run, and a failure/resume case",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/jobs/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/jobs/"],
    seed: (repo) => jobsSeed(repo, 2),
    score: (wt) => scoreJobs(wt, 2),
  },
  {
    id: "idempotent_job_runner_v3",
    matrixClasses: ["failure_recovery"],
    hardClass: "idempotent_job_runner",
    variant: 3,
    title: "Work commit resume v3",
    maxIterations: 6,
    objective:
      "Directors need a small work commit helper under src/jobs that can commit work by id once, survive retries after a partial failure, and never double-commit the same work id. Complete the half-built module into a coherent tested vertical slice. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "commitWork is idempotent for the same work id",
      "Partial failure leaves a recoverable recorded state",
      "Tests cover first commit, duplicate commit, and a failure/resume case",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/jobs/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/jobs/"],
    seed: (repo) => jobsSeed(repo, 3),
    score: (wt) => scoreJobs(wt, 3),
  },
  {
    id: "state_counter",
    matrixClasses: ["state_concurrency"],
    title: "Shared counter integrity",
    maxIterations: 6,
    objective:
      "Operators need incrementCounter(store, key, by = 1) under src/state. Contract (unambiguous): missing keys are created on first write (treat absent as 0 / default); do NOT reject a key merely because it is absent from the store; increments must accumulate with a single synchronous read-modify-write so sequential/concurrent callers do not lose updates; distinct keys stay independent; reject clearly invalid inputs only (non-string key, non-object store, non-finite by). Add tests covering create-on-first-write, accumulation, independence, and invalid input. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "Create-on-first-write: incrementCounter on a missing key initializes from 0/default and writes the increment (do not throw solely because the key is absent)",
      "Accumulating read-modify-write: same-key increments preserve prior totals (never replace with `by` alone)",
      "No lost updates under sequential/concurrent synchronous callers; independent keys do not interfere",
      "Invalid inputs fail clearly: non-string key, non-object store, and non-finite `by` are rejected",
      "Tests cover create-on-first-write, accumulation, multi-key independence, and invalid input",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/state/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/state/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-state", "node --test src/state/counter.test.js"));
      write(
        repo,
        "src/state/counter.js",
        [
          "/**",
          " * Contract: create-on-first-write (absent key => 0), accumulate, independent keys,",
          " * reject only invalid key/store/by shapes — never reject solely for a missing key.",
          " */",
          "export function incrementCounter(store, key, by = 1) {",
          "  // Lost-update style: replaces instead of accumulating when key exists",
          "  store[key] = by;",
          "  return store[key];",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/state/counter.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { incrementCounter } from './counter.js';",
          "",
          "test('create-on-first-write treats missing key as 0', () => {",
          "  const s = {};",
          "  assert.equal(incrementCounter(s, 'a', 1), 1);",
          "  assert.equal(s.a, 1);",
          "});",
          "",
          "test('accumulation preserves prior total', () => {",
          "  const s = { a: 5 };",
          "  assert.equal(incrementCounter(s, 'a', 3), 8);",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/state/counter.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/state/counter.test.js"), "utf8");
      const notes: string[] = [];
      const replacesOnly = /store\[key\]\s*=\s*by\s*;/.test(src) && !/\+\s*|Number\(|\?\?|\|\|/.test(src);
      const accumulates = !replacesOnly && (/\+\s*|Number\(|\?\?/.test(src) || /\|\|/.test(src));
      // Rejecting solely because the key is absent is the prior thrash failure mode.
      const rejectsMissingKey =
        /hasOwnProperty[\s\S]{0,120}throw|throw[\s\S]{0,120}(?:missing|not present|unknown key|Invalid key)/i.test(
          src,
        ) ||
        /rejects key not present|throw.*missing|missing key.*throw/i.test(testSrc);
      const createsOnFirstWrite =
        !rejectsMissingKey &&
        /create-on-first-write|missing key as 0|sets initial|empty \{\}/i.test(testSrc);
      const validates =
        (/throw|TypeError|invalid/i.test(src) &&
          (/string|typeof key|non-string/i.test(src) || /finite|Number\.isFinite|typeof by/i.test(src))) ||
        (/throw|TypeError/i.test(testSrc) && /invalid|non-string|non-finite|NaN/i.test(testSrc));
      const accumTest = /accum|twice|again|second|prior total|8|preserves/i.test(testSrc);
      const independence =
        /independent|another key|other key|['"]b['"]|['"]c['"]/i.test(testSrc) ||
        (testSrc.match(/incrementCounter\([^)]+,\s*['"][^'"]+['"]/g) ?? []).length >= 3;
      if (!accumulates) notes.push("still replaces instead of accumulating");
      if (rejectsMissingKey) notes.push("rejects missing key (must create-on-first-write)");
      if (!createsOnFirstWrite) notes.push("no create-on-first-write coverage");
      if (!validates) notes.push("no clear invalid-input rejection");
      if (!accumTest) notes.push("no accumulation test");
      if (!independence) notes.push("no multi-key independence signal");
      const pass =
        accumulates && !rejectsMissingKey && createsOnFirstWrite && validates && accumTest;
      return {
        pass,
        notes,
        robustScorecard: {
          state_integrity: accumulates && !rejectsMissingKey ? "PASS" : "FAIL",
          create_on_first_write: createsOnFirstWrite && !rejectsMissingKey ? "PASS" : "FAIL",
          validation: validates ? "PASS" : "FAIL",
          independence: independence ? "PASS" : "PARTIAL",
          tests: accumTest && createsOnFirstWrite ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "backward_compat_greet",
    matrixClasses: ["backward_compat"],
    title: "Greeting API compatibility",
    maxIterations: 6,
    objective:
      "Product needs formatGreeting under src/compat to support a preferred 'displayName' argument while remaining compatible with existing callers that pass 'name'. Keep both call shapes working with tests. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "New displayName shape works",
      "Legacy name shape still works",
      "Tests cover both shapes",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/compat/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/compat/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-compat", "node --test src/compat/greet.test.js"));
      write(
        repo,
        "src/compat/greet.js",
        ["export function formatGreeting({ name }) {", "  return `Hello, ${name}`;", "}", ""].join("\n"),
      );
      write(
        repo,
        "src/compat/greet.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { formatGreeting } from './greet.js';",
          "test('legacy name', () => {",
          "  assert.equal(formatGreeting({ name: 'Ada' }), 'Hello, Ada');",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/compat/greet.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/compat/greet.test.js"), "utf8");
      const notes: string[] = [];
      const supportsNew = /displayName/.test(src);
      const keepsLegacy = /name/.test(src);
      const bothTests = /displayName/i.test(testSrc) && /name/i.test(testSrc);
      if (!supportsNew) notes.push("no displayName support");
      if (!keepsLegacy) notes.push("legacy name path lost");
      if (!bothTests) notes.push("missing dual-shape tests");
      const pass = supportsNew && keepsLegacy && bothTests;
      return {
        pass,
        notes,
        robustScorecard: {
          backward_compat: keepsLegacy ? "PASS" : "FAIL",
          new_shape: supportsNew ? "PASS" : "FAIL",
          tests: bothTests ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "cross_cutting_label",
    matrixClasses: ["cross_cutting"],
    title: "Shared label formatter",
    maxIterations: 6,
    objective:
      "Directors need a shared label formatter used by both src/ui/badge.js and src/reports/line.js under src/shared so labels are consistent, validated, and tested. Keep changes inside authorized prefixes. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "Shared formatter exists and is used by both modules",
      "Invalid labels rejected",
      "Tests cover formatter",
      "No pull request is created",
    ],
    constraints: [
      "Stay inside src/shared/, src/ui/, and src/reports/",
      "Do not change PR, merge, or deploy behavior",
    ],
    authorizedPathPrefixes: ["src/shared/", "src/ui/", "src/reports/"],
    seed(repo) {
      write(
        repo,
        "package.json",
        pkg("ae-requal-cross", "node --test src/shared/label.test.js src/ui/badge.test.js"),
      );
      write(repo, "src/ui/badge.js", "export function badge(text) { return `[${text}]`; }\n");
      write(repo, "src/reports/line.js", "export function line(text) { return `* ${text}`; }\n");
      write(repo, "src/shared/.gitkeep", "");
      write(
        repo,
        "src/ui/badge.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { badge } from './badge.js';",
          "test('wraps', () => assert.equal(badge('x'), '[x]'));",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const sharedExists = fs.existsSync(path.join(wt, "src/shared")) &&
        fs.readdirSync(path.join(wt, "src/shared")).some((f) => f.endsWith(".js"));
      const badge = fs.readFileSync(path.join(wt, "src/ui/badge.js"), "utf8");
      const line = fs.readFileSync(path.join(wt, "src/reports/line.js"), "utf8");
      const notes: string[] = [];
      const importsShared = /from\s+['\"].*shared/i.test(badge) && /from\s+['\"].*shared/i.test(line);
      if (!sharedExists) notes.push("no shared module");
      if (!importsShared) notes.push("modules not using shared formatter");
      const pass = sharedExists && importsShared;
      return {
        pass,
        notes,
        robustScorecard: {
          cross_cutting: pass ? "PASS" : "FAIL",
          scope_discipline: pass ? "PASS" : "PARTIAL",
        },
      };
    },
  },
  {
    id: "agent_bad_code",
    matrixClasses: ["agent_generated_bad_code"],
    title: "Normalize helper cleanup",
    maxIterations: 6,
    objective:
      "Directors need normalizeToken under src/normalize to trim and lowercase tokens for production use with clear tests. Improve the existing helper so it is coherent and trustworthy: remove prior-agent HACK/TODO scaffolding, duplicate dead helpers/shims, and any circular/self-imports. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "normalizeToken trims and lowercases",
      "Invalid input rejected",
      "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/normalize/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/normalize/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-normalize", "node --test src/normalize/token.test.js"));
      write(
        repo,
        "src/normalize/token.js",
        [
          "export function normalizeToken_v1(s) { return String(s).toLowerCase(); }",
          "export function normalizeToken_v2(s) { return String(s).trim(); }",
          "// HACK: special-case for tests",
          "export function normalizeToken(s) {",
          "  if (s === 'TEST') return 'test';",
          "  try { return normalizeToken_v1(normalizeToken_v2(s)); } catch { return ''; }",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/normalize/token.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { normalizeToken } from './token.js';",
          "test('special', () => assert.equal(normalizeToken('TEST'), 'test'));",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score: scoreAgentBadCodeCleanup,
  },
  {
    id: "agent_bad_code_v2",
    matrixClasses: ["agent_generated_bad_code"],
    variant: 2,
    title: "Canonicalize helper cleanup",
    maxIterations: 6,
    objective:
      "Directors need canonicalizeToken under src/normalize to trim and lowercase tokens for production use with clear tests. Improve the existing helper so it is coherent and trustworthy: remove prior-agent HACK/TODO scaffolding, duplicate dead helpers/shims, and any circular/self-imports. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "canonicalizeToken trims and lowercases",
      "Invalid input rejected",
      "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/normalize/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/normalize/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-canonicalize", "node --test src/normalize/token.test.js"));
      write(
        repo,
        "src/normalize/token.js",
        [
          "export function canonicalizeToken_legacy(s) { return String(s).toLowerCase(); }",
          "export function canonicalizeToken_shim(s) { return String(s).trim(); }",
          "// TODO: special-case leftover from prior agent",
          "// HACK: keep tests green",
          "export function canonicalizeToken(s) {",
          "  if (s === 'LIVE') return 'live';",
          "  try { return canonicalizeToken_legacy(canonicalizeToken_shim(s)); } catch { return ''; }",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/normalize/dead-shim.js",
        [
          "// Unused shim left by a prior agent — should not survive cleanup",
          "export function unusedNormalizeShim(s) { return String(s); }",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/normalize/token.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { canonicalizeToken } from './token.js';",
          "test('special', () => assert.equal(canonicalizeToken('LIVE'), 'live'));",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score: (wt) => scoreAgentBadCodeCleanup(wt, { apiName: "canonicalizeToken", legacyNames: [/canonicalizeToken_legacy/, /canonicalizeToken_shim/, /unusedNormalizeShim/] }),
  },
  {
    id: "perf_lookup",
    matrixClasses: ["performance_awareness"],
    title: "Index lookup helper",
    maxIterations: 6,
    objective:
      "Operators need findById(items, id) under src/perf to look up records efficiently for lists that can grow large. Prefer an approach suitable for repeated lookups, with tests for found/missing. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "findById returns the matching record or null",
      "Implementation is suitable for repeated lookups on large lists (not nested full scans per call in a loop helper)",
      "Tests cover found and missing",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/perf/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/perf/"],
    seed(repo) {
      write(repo, "package.json", pkg("ae-requal-perf", "node --test src/perf/lookup.test.js"));
      write(
        repo,
        "src/perf/lookup.js",
        [
          "// Pathological: rebuilds and rescans on every call with nested loops",
          "export function findById(items, id) {",
          "  for (let i = 0; i < items.length; i++) {",
          "    for (let j = 0; j < items.length; j++) {",
          "      if (items[j].id === id && i === j) return items[j];",
          "    }",
          "  }",
          "  return null;",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/perf/lookup.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { findById } from './lookup.js';",
          "test('finds', () => {",
          "  assert.deepEqual(findById([{ id: 1 }, { id: 2 }], 2), { id: 2 });",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/perf/lookup.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/perf/lookup.test.js"), "utf8");
      const notes: string[] = [];
      const noNested = !/for\s*\([^)]+\)\s*\{\s*for\s*\(/.test(src);
      const hasMissingTest = /null|missing|absent|not found/i.test(testSrc);
      if (!noNested) notes.push("nested full scan remains");
      if (!hasMissingTest) notes.push("no missing-path test");
      const pass = noNested && hasMissingTest;
      return {
        pass,
        notes,
        robustScorecard: {
          performance_awareness: noNested ? "PASS" : "FAIL",
          functional_correctness: /return/.test(src) ? "PASS" : "FAIL",
          tests: hasMissingTest ? "PASS" : "PARTIAL",
        },
      };
    },
  },
];

export function specimensForHardClass(hard: HardClassId): SpecimenDef[] {
  return MATRIX_SPECIMENS.filter((s) => s.hardClass === hard).sort(
    (a, b) => (a.variant ?? 0) - (b.variant ?? 0),
  );
}

export function matrixCoverageIds(): string[] {
  return MATRIX_SPECIMENS.filter((s) => !s.hardClass || s.variant === 1).map((s) => s.id);
}
