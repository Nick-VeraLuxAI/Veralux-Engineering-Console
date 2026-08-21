/**
 * Fixture-contract tests for targeted robust requalification repairs.
 * Encodes unambiguous state_counter + agent_bad_code cleanup scoring.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MATRIX_SPECIMENS,
  scoreAgentBadCodeCleanup,
} from "../../../../scripts/runtime/autonomous-engineer/robust-requal-specimens";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-fixture-contract-"));
  tmpDirs.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

describe("state_counter fixture contract", () => {
  const specimen = MATRIX_SPECIMENS.find((s) => s.id === "state_counter");
  if (!specimen) throw new Error("state_counter missing");

  it("AC and objective encode create-on-first-write (not missing-key reject)", () => {
    expect(specimen.objective).toMatch(/create-on-first-write|created on first write/i);
    expect(specimen.objective).toMatch(/do NOT reject a key merely because it is absent/i);
    expect(specimen.acceptanceCriteria.join("\n")).toMatch(/Create-on-first-write/i);
    expect(specimen.acceptanceCriteria.join("\n")).not.toMatch(/^Invalid key\/by rejected$/m);
  });

  it("seed tests require create-on-first-write and do not assert missing-key throw", () => {
    const repo = tmp();
    specimen.seed(repo);
    const testSrc = fs.readFileSync(path.join(repo, "src/state/counter.test.js"), "utf8");
    expect(testSrc).toMatch(/create-on-first-write/i);
    expect(testSrc).not.toMatch(/rejects key not present/i);
    const seedScore = specimen.score(repo);
    expect(seedScore.pass).toBe(false);
    expect(seedScore.notes.join(" ")).toMatch(/replaces|accumulat/i);
  });

  it("score fails hasOwnProperty-reject thrash and passes correct accumulate implementation", () => {
    const bad = writeTree(tmp(), {
      "src/state/counter.js": [
        "export function incrementCounter(store, key, by = 1) {",
        "  if (!Object.prototype.hasOwnProperty.call(store, key)) {",
        "    throw new TypeError(`Invalid key: ${key}`);",
        "  }",
        "  store[key] = (typeof store[key] === 'number' ? store[key] : 0) + by;",
        "  return store[key];",
        "}",
        "",
      ].join("\n"),
      "src/state/counter.test.js": [
        "import test from 'node:test';",
        "test('create-on-first-write treats missing key as 0', () => {});",
        "test('accumulation preserves prior total', () => {});",
        "test('rejects key not present', () => {});",
        "",
      ].join("\n"),
    });
    const badScore = specimen.score(bad);
    expect(badScore.pass).toBe(false);
    expect(badScore.notes.join(" ")).toMatch(/missing key|create-on-first-write/i);

    const good = writeTree(tmp(), {
      "src/state/counter.js": [
        "export function incrementCounter(store, key, by = 1) {",
        "  if (typeof store !== 'object' || store === null) throw new TypeError('store');",
        "  if (typeof key !== 'string') throw new TypeError('key');",
        "  if (typeof by !== 'number' || !Number.isFinite(by)) throw new TypeError('by');",
        "  const next = (Number(store[key]) || 0) + by;",
        "  store[key] = next;",
        "  return next;",
        "}",
        "",
      ].join("\n"),
      "src/state/counter.test.js": [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { incrementCounter } from './counter.js';",
        "test('create-on-first-write treats missing key as 0', () => {",
        "  const s = {};",
        "  assert.equal(incrementCounter(s, 'a', 1), 1);",
        "});",
        "test('accumulation preserves prior total', () => {",
        "  const s = { a: 5 };",
        "  assert.equal(incrementCounter(s, 'a', 3), 8);",
        "});",
        "test('independent keys', () => {",
        "  const s = {};",
        "  incrementCounter(s, 'a', 1);",
        "  incrementCounter(s, 'b', 2);",
        "  assert.equal(s.a, 1);",
        "  assert.equal(s.b, 2);",
        "});",
        "test('invalid non-string key', () => {",
        "  assert.throws(() => incrementCounter({}, 1, 1), TypeError);",
        "});",
        "",
      ].join("\n"),
    });
    const goodScore = specimen.score(good);
    expect(goodScore.pass).toBe(true);
    expect(goodScore.robustScorecard.create_on_first_write).toBe("PASS");
  });
});

describe("agent_bad_code cleanup scoring", () => {
  it("fails circular self-import and legacy residue (prior partial success shape)", () => {
    const wt = writeTree(tmp(), {
      "src/normalize/token.js": [
        "import { normalizeToken as _legacy } from './token.js';",
        "// Legacy helpers retained",
        "export function normalizeToken(s) { return String(s).trim().toLowerCase(); }",
        "",
      ].join("\n"),
      "src/normalize/token.test.js":
        "import test from 'node:test';\ntest('x', () => {});\n",
    });
    const score = scoreAgentBadCodeCleanup(wt);
    expect(score.pass).toBe(false);
    expect(score.notes.join(" ")).toMatch(/circular|self-import/i);
  });

  it("fails HACK/TODO and dead shim leftovers", () => {
    const wt = writeTree(tmp(), {
      "src/normalize/token.js": [
        "export function normalizeToken_v1(s) { return String(s).toLowerCase(); }",
        "// HACK: leftover",
        "export function normalizeToken(s) { return String(s).trim().toLowerCase(); }",
        "",
      ].join("\n"),
      "src/normalize/dead-shim.js": "export function unusedNormalizeShim(s) { return s; }\n",
      "src/normalize/token.test.js": "import test from 'node:test';\n",
    });
    const score = scoreAgentBadCodeCleanup(wt);
    expect(score.pass).toBe(false);
    expect(score.notes.join(" ")).toMatch(/HACK|dead|duplicate/i);
  });

  it("passes clean normalize delivery", () => {
    const wt = writeTree(tmp(), {
      "src/normalize/token.js": [
        "export function normalizeToken(s) {",
        "  if (typeof s !== 'string') throw new TypeError('invalid');",
        "  return s.trim().toLowerCase();",
        "}",
        "",
      ].join("\n"),
      "src/normalize/token.test.js": [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { normalizeToken } from './token.js';",
        "test('norm', () => assert.equal(normalizeToken(' A '), 'a'));",
        "test('invalid', () => assert.throws(() => normalizeToken(null)));",
        "",
      ].join("\n"),
    });
    expect(scoreAgentBadCodeCleanup(wt).pass).toBe(true);
  });

  it("agent_bad_code_v2 seed scores fail until cleaned", () => {
    const specimen = MATRIX_SPECIMENS.find((s) => s.id === "agent_bad_code_v2");
    expect(specimen).toBeTruthy();
    const repo = tmp();
    specimen!.seed(repo);
    const score = specimen!.score(repo);
    expect(score.pass).toBe(false);
    expect(score.notes.join(" ")).toMatch(/HACK|TODO|dead|duplicate/i);
  });

  it("agent_bad_code_v3 seed scores fail until cleaned", () => {
    const specimen = MATRIX_SPECIMENS.find((s) => s.id === "agent_bad_code_v3");
    expect(specimen).toBeTruthy();
    const repo = tmp();
    specimen!.seed(repo);
    expect(fs.existsSync(path.join(repo, "src/normalize/dead-shim.js"))).toBe(true);
    const score = specimen!.score(repo);
    expect(score.pass).toBe(false);
    expect(score.notes.join(" ")).toMatch(/HACK|TODO|dead|duplicate/i);
  });
});

describe("state_counter_v2 fixture freeze", () => {
  it("preserves create-on-first-write contract identical to state_counter", () => {
    const v1 = MATRIX_SPECIMENS.find((s) => s.id === "state_counter");
    const v2 = MATRIX_SPECIMENS.find((s) => s.id === "state_counter_v2");
    expect(v1 && v2).toBeTruthy();
    expect(v2!.objective).toMatch(/create-on-first-write|created on first write/i);
    expect(v2!.acceptanceCriteria.join("\n")).toMatch(/Create-on-first-write/i);
    const repo = tmp();
    v2!.seed(repo);
    expect(v2!.score(repo).pass).toBe(false);
  });
});

describe("state_counter_v3 fixture freeze", () => {
  it("preserves create-on-first-write contract for final third variant", () => {
    const v3 = MATRIX_SPECIMENS.find((s) => s.id === "state_counter_v3");
    expect(v3).toBeTruthy();
    expect(v3!.objective).toMatch(/create-on-first-write|created on first write/i);
    expect(v3!.acceptanceCriteria.join("\n")).toMatch(/Create-on-first-write/i);
    const repo = tmp();
    v3!.seed(repo);
    expect(v3!.score(repo).pass).toBe(false);
  });
});
