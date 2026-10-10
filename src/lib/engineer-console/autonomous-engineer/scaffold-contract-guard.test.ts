import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { AutonomousDocument } from "./types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import {
  detectContractShapeRegressions,
  detectImplementerShapeRegressions,
  detectMissingContractExports,
  extractTypeScriptExports,
  formatContractsContextBlock,
  isContractsFrozen,
  objectiveTouchesContracts,
  shouldFreezeContractsAfterRepairs,
  validatePlanScaffoldOperations,
  validateProtectedScaffoldContent,
} from "./scaffold-contract-guard";

describe("scaffold contract guard", () => {
  it("extracts exported type and interface names", () => {
    const names = extractTypeScriptExports(`
export type MemoryEvent = { id: string };
export interface EventLog { append(): void }
export class InMemoryEventLog {}
export { foo as bar };
`);
    expect([...names]).toEqual(
      expect.arrayContaining(["MemoryEvent", "EventLog", "InMemoryEventLog", "bar"]),
    );
  });

  it("detects removed exports", () => {
    const baseline = `
export interface EventLog {}
export interface MemoryRecordStore {}
export type MemoryRecord = { id: string };
`;
    const next = `
export type MemoryRecord = { id: string };
`;
    expect(detectMissingContractExports(baseline, next)).toEqual(["EventLog", "MemoryRecordStore"]);
  });

  it("allows additive contract changes", () => {
    const baseline = `export interface EventLog {}\n`;
    const next = `export interface EventLog {}\nexport type MemoryRecordWriteInput = {};\n`;
    expect(detectMissingContractExports(baseline, next)).toEqual([]);
  });

  it("detects removed MemoryRecord.kind field", () => {
    const baseline = `export type MemoryRecord = { kind: MemoryRecordKind; supersededById?: string; }`;
    const next = `export type MemoryRecord = { memoryClass: MemoryClass; }`;
    expect(detectContractShapeRegressions(baseline, next)[0]).toMatch(
      /MemoryRecord\.kind removed or renamed/,
    );
  });

  it("detects context-assembler return shape regression", () => {
    const baseline = `return { text, recordIds, eventIds, estimatedTokens };`;
    const next = `return { summary, recordIds, provenanceEventIds, truncated };`;
    expect(
      detectImplementerShapeRegressions("src/context-assembler.ts", baseline, next)[0],
    ).toMatch(/AssembledContext/);
  });

  it("detects memory-record-store method regression", () => {
    const baseline = `upsert() {} get() {} list() {} supersede() {}`;
    const next = `create() {} update() {}`;
    expect(
      detectImplementerShapeRegressions("src/memory-record-store.ts", baseline, next)[0],
    ).toMatch(/upsert/);
  });

  it("objectiveTouchesContracts detects contract-related missions", () => {
    expect(
      objectiveTouchesContracts({
        objective: "Add MemoryProposal type to src/contracts.ts",
      }),
    ).toBe(true);
    expect(
      objectiveTouchesContracts({
        objective: "Add src/consolidation.ts only",
      }),
    ).toBe(false);
  });

  it("shouldFreezeContractsAfterRepairs after two scaffold repairs", () => {
    expect(
      shouldFreezeContractsAfterRepairs([
        { at: "t", semanticIteration: 0, kind: "scaffold_contract", reason: "a" },
        { at: "t", semanticIteration: 0, kind: "scaffold_contract", reason: "b" },
      ]),
    ).toBe(true);
  });

  it("validateProtectedScaffoldContent ignores non-scaffold paths", () => {
    expect(
      validateProtectedScaffoldContent({
        baselineRepoPath: "/tmp",
        relativePath: "src/store.ts",
        nextContent: "export {}",
      }),
    ).toEqual([]);
  });

  it("formatContractsContextBlock includes full file when objective touches contracts", () => {
    const dir = "/tmp/scaffold-guard-test";
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/contracts.ts"), "export type Foo = { id: string };\n");
    const block = formatContractsContextBlock(dir, true);
    expect(block).toContain("FULL src/contracts.ts");
    expect(block).toContain("export type Foo");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("validatePlanScaffoldOperations", () => {
  it("blocks mutations to frozen contracts.ts", () => {
    const dir = "/tmp/scaffold-plan-test";
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/contracts.ts"), "export type Foo = { id: string };\n");

    const document = {
      scaffoldGuard: { contractsFrozen: true },
    } as AutonomousDocument;

    const plan: WorkerPlan = {
      runId: "r1",
      summary: "bad",
      allowedFiles: ["src/contracts.ts"],
      operations: [
        { type: "update_file", path: "src/contracts.ts", content: "export type Bar = {};\n" },
      ],
    };

    const errors = validatePlanScaffoldOperations(dir, plan, document);
    expect(errors[0]).toMatch(/frozen/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("isContractsFrozen reads document flag", () => {
    expect(isContractsFrozen({ scaffoldGuard: { contractsFrozen: true } } as AutonomousDocument)).toBe(
      true,
    );
  });
});
