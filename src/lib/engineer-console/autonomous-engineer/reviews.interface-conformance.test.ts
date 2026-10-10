import { describe, expect, it } from "vitest";
import { interfaceMethodConformanceDefects } from "./reviews";

describe("interfaceMethodConformanceDefects", () => {
  it("flags create() when MemoryRecordStore requires upsert()", () => {
    const defects = interfaceMethodConformanceDefects({
      "src/contracts.ts": `
export interface MemoryRecordStore {
  upsert(record: unknown): unknown;
  get(id: string): unknown;
  list(scope?: unknown): unknown[];
  supersede(id: string, next: unknown): unknown;
}
`,
      "src/memory-record-store.ts": `
export class MemoryRecordStore {
  create(input: unknown) { return input; }
  get(id: string) { return undefined; }
  list() { return []; }
  supersede(id: string, next: unknown) { return next; }
}
`,
    });
    expect(defects.join("\n")).toMatch(/upsert/);
    expect(defects.join("\n")).toMatch(/create\(\)/);
  });

  it("passes when upsert/get/list/supersede exist", () => {
    const defects = interfaceMethodConformanceDefects({
      "src/contracts.ts": `
export interface MemoryRecordStore {
  upsert(record: unknown): unknown;
  get(id: string): unknown;
  list(scope?: unknown): unknown[];
  supersede(id: string, next: unknown): unknown;
}
`,
      "src/memory-record-store.ts": `
export class InMemoryMemoryRecordStore {
  upsert(record: unknown) { return record; }
  get(id: string) { return undefined; }
  list() { return []; }
  supersede(id: string, next: unknown) { return next; }
}
`,
    });
    expect(defects).toEqual([]);
  });
});
