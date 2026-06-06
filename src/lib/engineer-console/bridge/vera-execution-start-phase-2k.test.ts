import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Vera execution start Phase 2K", () => {
  it("start service wraps central executeRun only", () => {
    const source = readFileSync(
      path.join(root, "src/lib/engineer-console/bridge/start-vera-execution.ts"),
      "utf8",
    );
    expect(source).toContain('from "../orchestrator/run-orchestrator"');
    expect(source).toContain("executeRun");
    expect(source).not.toMatch(/from\s+["'].*git-workspace["']/);
    expect(source).not.toMatch(/worker-plan-orchestrator/);
  });

  it("run page mounts start panel and preserves execution block until started", () => {
    const page = readFileSync(
      path.join(root, "src/app/(main)/engineer/runs/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("VeraExecutionStartPanel");
    expect(page).toContain("assessVeraExecutionStartReadiness");
    expect(page).toContain("isVeraRunExecutionBlocked");
  });

  it("run live panel keeps worker panels gated until Vera start accepted", () => {
    const panel = readFileSync(
      path.join(root, "src/components/engineer-console/run-live-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("veraExecutionBlocked");
    expect(panel).toContain("Vera handoff execution is gated");
  });

  it("start route uses mutation auth", () => {
    const route = readFileSync(
      path.join(root, "src/app/api/engineer-console/runs/[id]/start-vera-execution/route.ts"),
      "utf8",
    );
    expect(route).toContain("authorizeMutation");
    expect(route).toContain("startVeraExecution");
  });
});
