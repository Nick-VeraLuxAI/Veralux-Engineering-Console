import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("autonomous engineer API governance", () => {
  it("wraps new AE routes with auth/CSRF mutation guards", () => {
    const files = [
      "src/app/api/engineer-console/runs/[id]/autonomous/route.ts",
      "src/app/api/engineer-console/runs/[id]/autonomous/clarification/route.ts",
      "src/app/api/engineer-console/runs/[id]/autonomous/abort/route.ts",
      "src/app/api/engineer-console/runs/[id]/autonomous/completion/route.ts",
      "src/app/api/engineer-console/tasks/[id]/runs/route.ts",
    ];
    const root = path.join(process.cwd());
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toMatch(/authorize(Read|Mutation)/);
      if (file.includes("clarification") || file.includes("abort") || file.endsWith("runs/route.ts")) {
        expect(source).toContain("authorizeMutation");
      }
    }
  });

  it("does not let the loop call human approval or release gates", () => {
    const loop = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/autonomous-engineer/loop.ts"),
      "utf8",
    );
    expect(loop).not.toContain("handleApprovalAction");
    expect(loop).not.toContain("merge-pr");
    expect(loop).not.toContain("production-deploy");
    expect(loop).toContain("submitAndExecuteWorkerPlan");
    expect(loop).toContain("iterationMode: true");
    expect(loop).toContain("coerceWorkerPlanToWorktree");
  });

  it("does not invoke client-only Vera panel helpers from the run server page", () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), "src/app/(main)/engineer/runs/[id]/page.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/canShowVera[A-Za-z]+\(/);
  });
});
