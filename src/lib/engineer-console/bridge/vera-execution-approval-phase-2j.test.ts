import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const READINESS = "src/lib/engineer-console/bridge/vera-execution-readiness.ts";
const REQUEST = "src/lib/engineer-console/bridge/request-vera-execution-approval.ts";
const ROUTE = "src/app/api/engineer-console/runs/[id]/request-vera-execution-approval/route.ts";
const PANEL = "src/components/engineer-console/vera-execution-approval-panel.tsx";
const RUN_PAGE = "src/app/(main)/engineer/runs/[id]/page.tsx";
const RUN_LIVE = "src/components/engineer-console/run-live-panel.tsx";

describe("Vera execution approval gate Phase 2J", () => {
  it("readiness service verifies Vera prepared run metadata", () => {
    const source = readFileSync(path.join(root, READINESS), "utf8");
    expect(source).toContain("assessVeraExecutionReadiness");
    expect(source).toContain("VERA_IMPLEMENTATION_RUN_PREPARED_STEP");
    expect(source).toContain("getLatestHermesDispatchForRun");
    expect(source).toContain("isVeraRunExecutionBlocked");
  });

  it("approval request route uses mutation auth and does not execute", () => {
    const source = readFileSync(path.join(root, ROUTE), "utf8");
    expect(source).toContain("ensureEngineerConsoleReady");
    expect(source).toContain("authorizeMutation");
    expect(source).toContain("requestVeraExecutionApproval");
    expect(source).not.toMatch(/executeRun\s*\(/);
  });

  it("run page mounts Vera execution approval panel", () => {
    const source = readFileSync(path.join(root, RUN_PAGE), "utf8");
    expect(source).toContain("VeraExecutionApprovalPanel");
    expect(source).toContain("assessVeraExecutionReadiness");
    expect(source).toContain("veraExecutionBlocked");
  });

  it("run live panel gates worker and Hermes panels for Vera runs", () => {
    const source = readFileSync(path.join(root, RUN_LIVE), "utf8");
    expect(source).toContain("veraExecutionBlocked");
    expect(source).toContain("Vera handoff execution is gated");
    expect(source).toContain("HermesWorkerPanel");
  });

  it("UI panel includes confirmation gate and readiness checklist", () => {
    const source = readFileSync(path.join(root, PANEL), "utf8");
    expect(source).toContain("Vera execution approval gate");
    expect(source).toContain("vera-handoff-task-types");
    expect(source).toContain("Readiness checklist");
    expect(source).toContain("Execution approval requested — no code executed");
    expect(source).not.toMatch(/executeRun\s*\(/);
  });

  it("request service sets approval-requested step only", () => {
    const source = readFileSync(path.join(root, REQUEST), "utf8");
    expect(source).toContain("VERA_EXECUTION_APPROVAL_REQUESTED_STEP");
    expect(source).toContain("updateRun");
    expect(source).not.toContain("executeRun");
  });
});
