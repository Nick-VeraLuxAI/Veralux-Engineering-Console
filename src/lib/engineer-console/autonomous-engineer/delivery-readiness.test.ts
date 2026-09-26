import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthorityEnvelope } from "./authority";
import { evaluateCompletion } from "./completion-evaluator";
import {
  evaluateStructuralDeliveryGates,
  qcEvidenceSupportsDelivery,
} from "./delivery-readiness";
import type { QcDelta } from "./qc-baseline";
import type { AutonomousDocument } from "./types";
import type { EngineeringTask } from "../types";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-delivery-"));
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

function fakeTask(): EngineeringTask {
  return {
    id: "t1",
    title: "Memory Module V0",
    description: "Build Memory Module V0",
    targetRepoPath: "/tmp",
    registeredRepoId: null,
    status: "in_progress",
    priority: "normal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function skippedOnlyDelta(): QcDelta {
  return {
    capturedAt: new Date().toISOString(),
    findings: [
      {
        identity: {
          key: "skipped:(none)",
          kind: "command",
          command: "(none)",
          name: "skipped",
          fingerprint: "skipped",
          rawEvidence: "No quality gate scripts",
        },
        classification: "SKIPPED",
        baselineFingerprint: null,
        currentFingerprint: "skipped",
      },
    ],
    newFailures: [],
    preExistingFailures: [],
    changedFailures: [],
    resolvedBaselineFailures: [],
    infrastructureFailures: [],
    skipped: [
      {
        identity: {
          key: "skipped:(none)",
          kind: "command",
          command: "(none)",
          name: "skipped",
          fingerprint: "skipped",
          rawEvidence: "No quality gate scripts",
        },
        classification: "SKIPPED",
        baselineFingerprint: null,
        currentFingerprint: "skipped",
      },
    ],
    objectiveQcPassed: true,
    ownedIterationFailures: [],
  };
}

function memoryDoc(overrides: Partial<AutonomousDocument> = {}): AutonomousDocument {
  return {
    originalObjective:
      "Implement Memory Module V0 in TypeScript with event log, tests, and vitest",
    acceptanceCriteria: [
      "npm test passes",
      "TypeScript event log contracts exist",
    ],
    requirements: ["append-only event log", "unit tests"],
    authorizedPathPrefixes: ["src/"],
    unresolvedDefects: [],
    authorityEnvelope: buildAuthorityEnvelope(fakeTask(), ["src/"]),
    reviews: [],
    qcDelta: null,
    interpretedObjective: {
      objectiveSummary: "Memory Module V0 foundation",
      requirements: ["append-only event log", "unit tests"],
      acceptanceCriteria: ["npm test passes", "TypeScript event log contracts exist"],
      constraints: [],
      assumptions: [],
      unknowns: [],
      clarificationRequired: false,
      clarificationQuestions: [],
      initialInvestigationTargets: [],
    },
    ...overrides,
  } as unknown as AutonomousDocument;
}

function passingReviews() {
  return [
    { review: "requirements" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "diff_quality" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "regression_risk" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "scope" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "engineering_quality" as const, passed: true, findings: [], actionableDefects: [] },
  ];
}

describe("delivery readiness — autonomy gap close", () => {
  it("rejects skipped-only QC as delivery evidence", () => {
    expect(qcEvidenceSupportsDelivery(skippedOnlyDelta())).toBe(false);
    expect(qcEvidenceSupportsDelivery(null)).toBe(false);
  });

  it("blocks thin Map get/set stub for Memory Module objectives", () => {
    const repo = writeTree(tmp(), {
      "src/memory.js": `
const memoryStore = new Map();
export function get(key) { return memoryStore.get(key); }
export function set(key, value) { memoryStore.set(key, value); }
export function del(key) { return memoryStore.delete(key); }
export function clear() { memoryStore.clear(); }
`,
      "src/memory.test.js": `import { get, set } from './memory.js';`,
    });
    const blockers = evaluateStructuralDeliveryGates({
      document: memoryDoc({ qcDelta: skippedOnlyDelta() }),
      repoPath: repo,
      qcDelta: skippedOnlyDelta(),
      changedFiles: ["src/memory.js", "src/memory.test.js"],
    });
    expect(blockers.join(" ")).toMatch(/skipped|thin key-value|TypeScript|test script|domain/i);
  });

  it("evaluateCompletion stays incomplete for the Memory Module stub pattern", () => {
    const repo = writeTree(tmp(), {
      "src/memory.js": `
const memoryStore = new Map();
export function get(key) { return memoryStore.get(key); }
export function set(key, value) { memoryStore.set(key, value); }
`,
    });
    const evaluation = evaluateCompletion({
      document: memoryDoc({ qcDelta: skippedOnlyDelta() }),
      qcPassed: true,
      changedFiles: ["src/memory.js"],
      reviews: passingReviews(),
      repoPath: repo,
      qcDelta: skippedOnlyDelta(),
    });
    expect(evaluation.complete).toBe(false);
    expect(evaluation.unmetAcceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("does not treat ready.txt-only specimens as thin Map stubs", () => {
    const repo = writeTree(tmp(), {
      "package.json": JSON.stringify({ name: "specimen", scripts: { test: "node test.js" } }),
      "src/ready.txt": "ok\n",
    });
    const doc = memoryDoc({
      originalObjective: "Add src/ready.txt so the test script passes.",
      interpretedObjective: {
        objectiveSummary: "Add src/ready.txt so the test script passes.",
        requirements: ["ready.txt exists"],
        acceptanceCriteria: ["npm test passes"],
        constraints: [],
        assumptions: [],
        unknowns: [],
        clarificationRequired: false,
        clarificationQuestions: [],
        initialInvestigationTargets: [],
      },
    });
    const greenDelta: QcDelta = {
      ...skippedOnlyDelta(),
      findings: [],
      skipped: [],
      objectiveQcPassed: true,
    };
    const blockers = evaluateStructuralDeliveryGates({
      document: doc,
      repoPath: repo,
      qcDelta: greenDelta,
      changedFiles: ["src/ready.txt"],
    });
    expect(blockers.some((b) => /thin key-value Map stub/i.test(b))).toBe(false);
  });

  it("allows a real TypeScript event-log delivery when QC is not skipped-only", () => {
    const repo = writeTree(tmp(), {
      "package.json": JSON.stringify({
        name: "memory-module",
        scripts: { test: "vitest run" },
      }),
      "src/contracts.ts":
        "export type MemoryEvent = { id: string }; export interface EventLog { append(): MemoryEvent }\n",
      "src/event-log.ts":
        "export class InMemoryEventLog { append() { return { id: '1' }; } }\n",
      "src/event-log.test.ts": "import { describe, it, expect } from 'vitest';\n",
    });
    const greenDelta: QcDelta = {
      ...skippedOnlyDelta(),
      findings: [],
      skipped: [],
      objectiveQcPassed: true,
    };
    const evaluation = evaluateCompletion({
      document: memoryDoc({ qcDelta: greenDelta }),
      qcPassed: true,
      changedFiles: ["src/contracts.ts", "src/event-log.ts", "src/event-log.test.ts"],
      reviews: passingReviews(),
      repoPath: repo,
      qcDelta: greenDelta,
    });
    expect(evaluation.complete).toBe(true);
  });
});
