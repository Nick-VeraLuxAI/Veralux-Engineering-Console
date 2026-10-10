import { describe, expect, it } from "vitest";
import {
  hasJsonOverEscapedSource,
  sanitizeWorkerPlanFileContent,
} from "./worker-plan-content-sanitize";

describe("worker-plan-content-sanitize", () => {
  it("unwraps JSON-over-escaped TypeScript imports", () => {
    const raw = 'import { describe, it, expect } from \\"vitest\\";';
    expect(sanitizeWorkerPlanFileContent(raw)).toBe('import { describe, it, expect } from "vitest";');
    expect(hasJsonOverEscapedSource(raw)).toBe(true);
  });

  it("expands literal \\n blobs into multiline source", () => {
    const raw = 'export const x = 1;\\nexport const y = 2;';
    expect(sanitizeWorkerPlanFileContent(raw)).toBe("export const x = 1;\nexport const y = 2;");
  });
});
