import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildIntegrationGroundingBlock,
  extractExportSignatures,
  objectiveNeedsIntegrationGrounding,
  readIntegrationModuleSignatures,
} from "./integration-grounding";

let tmp: string | null = null;

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("integration grounding", () => {
  it("detects facade orchestration objectives", () => {
    expect(
      objectiveNeedsIntegrationGrounding({
        objective: "Unify subsystems behind MemoryService facade with recall()",
      }),
    ).toBe(true);
    expect(
      objectiveNeedsIntegrationGrounding({
        objective: "Add src/version.ts export only",
      }),
    ).toBe(false);
  });

  it("extracts export signatures from source", () => {
    const sigs = extractExportSignatures(`
export function hybridRetrieve(query: RetrievalQuery, records: MemoryRecord[]): RankedCandidate[] {}
export class BudgetedContextAssembler {}
`);
    expect(sigs.some((s) => s.includes("hybridRetrieve"))).toBe(true);
    expect(sigs.some((s) => s.includes("BudgetedContextAssembler"))).toBe(true);
  });

  it("buildIntegrationGroundingBlock includes API crib for Memory-Module", () => {
    tmp = path.join(os.tmpdir(), "Memory-Module-int-ground-test");
    const src = path.join(tmp, "src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, "write-pipeline.ts"),
      "export function commitProposal(store: MemoryRecordStore, proposal: MemoryProposal): MemoryRecord {}\n",
    );
    const block = buildIntegrationGroundingBlock(tmp, {
      objective: "MemoryService facade with proposeAndCommit and recall",
    });
    expect(block).toMatch(/INTEGRATION MODE/);
    expect(block).toMatch(/commitProposal/);
    expect(block).toMatch(/hybridRetrieve/);
  });

  it("readIntegrationModuleSignatures skips missing files", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "int-ground-"));
    expect(readIntegrationModuleSignatures(tmp, ["src/missing.ts"])).toEqual([]);
  });
});
