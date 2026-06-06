import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const forbidden = [
  /createGovernedPullRequest/,
  /merge-governed-pull-request/,
  /controlled-gh-merge/,
  /execute-staging-deployment/,
  /execute-production-deployment/,
  /createGovernedLocalCommit/,
  /push-remote-branch/,
  /child_process/,
];

const files = [
  "src/lib/engineer-console/worker/vera-implementation-worker.ts",
  "src/lib/engineer-console/orchestrator/vera-implementation-run-pipeline.ts",
  "src/lib/engineer-console/orchestrator/run-orchestrator.ts",
];

describe("Vera implementation worker Phase 2L safety", () => {
  it("worker and pipeline do not import PR/merge/deploy/commit helpers", () => {
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("run page mounts implementation artifact panel", () => {
    const page = readFileSync(
      path.join(root, "src/app/(main)/engineer/runs/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("VeraImplementationArtifactPanel");
    expect(page).toContain("readVeraImplementationArtifact");
  });
});
