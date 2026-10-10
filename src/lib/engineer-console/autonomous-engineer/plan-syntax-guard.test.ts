import { describe, expect, it } from "vitest";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { validatePlanTypeScriptSyntax } from "./plan-syntax-guard";

describe("validatePlanTypeScriptSyntax", () => {
  it("accepts valid TypeScript", () => {
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "ok",
      allowedFiles: ["src/foo.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/foo.ts",
          content: 'export const x = 1;\n',
        },
      ],
    };
    expect(validatePlanTypeScriptSyntax("/tmp", plan)).toEqual([]);
  });

  it("rejects parse errors before execution", () => {
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "bad",
      allowedFiles: ["src/bad.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/bad.ts",
          content: "export function foo( { return 1 }\n",
        },
      ],
    };
    const errors = validatePlanTypeScriptSyntax("/tmp", plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/syntax error/);
  });

  it("rejects illegal .ts relative imports (TS5097)", () => {
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "illegal import",
      allowedFiles: ["src/service.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/service.ts",
          content: 'import { foo } from "./contracts.ts";\nexport const x = foo;\n',
        },
      ],
    };
    const errors = validatePlanTypeScriptSyntax("/tmp", plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/TS5097/);
    expect(errors[0]).toMatch(/contracts\.js/);
  });

  it("rejects duplicate export statements (TS2323/TS2484)", () => {
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "duplicate export",
      allowedFiles: ["src/service.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/service.ts",
          content: 'export class MemoryService {}\nexport { MemoryService };\n',
        },
        {
          type: "create_file",
          path: "src/multi.ts",
          content: 'export class InMemoryFeedbackLog {}\nexport { InMemoryFeedbackLog, FeedbackLog };\n',
        },
      ],
    };
    const errors = validatePlanTypeScriptSyntax("/tmp", plan);
    expect(errors.length).toBe(2);
    expect(errors[0]).toMatch(/duplicate export 'MemoryService'/i);
    expect(errors[1]).toMatch(/duplicate export 'InMemoryFeedbackLog'/i);
  });
});
