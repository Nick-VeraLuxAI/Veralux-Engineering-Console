import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerPlanDraftPanel } from "@/components/engineer-console/worker-plan-draft-panel";
import { WorkerPlanPanel } from "@/components/engineer-console/worker-plan-panel";
import { validateWorkerPlanPayload } from "./worker-plan-validation";
import {
  analyzeWorkerPlanIntent,
  buildGuidedWorkerPlan,
  buildReadmeSmokeWorkerPlan,
  buildWorkerPlanPreview,
  inspectWorkerPlanJsonInput,
  shouldShowReadmeSmokeHelper,
} from "./worker-plan-ux";

const mockFetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/engineer-console-client/fetch", () => ({
  engineerConsoleFetch: (...args: unknown[]) => mockFetch(...args),
}));

describe("worker plan UX helpers", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("guided builder creates worker-plan JSON with current runId", () => {
    const result = buildGuidedWorkerPlan({
      runId: "run-123",
      summary: "Create README note",
      operations: [
        {
          type: "create_file",
          path: "README.md",
          content: "# hello\n",
          reason: "smoke test",
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toEqual({
      runId: "run-123",
      summary: "Create README note",
      allowedFiles: ["README.md"],
      operations: [
        {
          type: "create_file",
          path: "README.md",
          content: "# hello\n",
          reason: "smoke test",
        },
      ],
    });
  });

  it("operator does not need to manually enter runId in guided mode", () => {
    const result = buildGuidedWorkerPlan({
      runId: "run-current",
      summary: "Update docs",
      operations: [
        {
          type: "update_file",
          path: "docs/guide.md",
          content: "Updated\n",
          reason: "align copy",
        },
      ],
    });

    expect(result.plan?.runId).toBe("run-current");
    expect(result.plan?.allowedFiles).toEqual(["docs/guide.md"]);
  });

  it("README smoke helper populates README plan in test or development contexts", () => {
    expect(
      shouldShowReadmeSmokeHelper({
        nodeEnv: "test",
        auditChainScope: "global",
        taskTitle: "Generic task",
        taskDescription: "Do something",
      }),
    ).toBe(true);

    const plan = buildReadmeSmokeWorkerPlan("run-smoke");
    expect(plan.runId).toBe("run-smoke");
    expect(plan.summary).toBe("Create README staging verification note");
    expect(plan.allowedFiles).toEqual(["README.md"]);
    expect(plan.operations[0]).toMatchObject({
      type: "create_file",
      path: "README.md",
    });
  });

  it("smoke helper stays hidden when context is not eligible", () => {
    expect(
      shouldShowReadmeSmokeHelper({
        nodeEnv: "production",
        auditChainScope: "global",
        taskTitle: "Add button styles",
        taskDescription: "Update the UI theme",
      }),
    ).toBe(false);
  });

  it("plan preview lists create, update, and append operations", () => {
    const preview = buildWorkerPlanPreview({
      runId: "run-1",
      summary: "Multi-op",
      allowedFiles: ["README.md", "src/app.ts"],
      operations: [
        {
          type: "create_file",
          path: "README.md",
          content: "x",
          reason: "create",
        },
        {
          type: "update_file",
          path: "src/app.ts",
          content: "y",
          reason: "update",
        },
        {
          type: "append_file",
          path: "README.md",
          content: "z",
          reason: "append",
        },
      ],
    });

    expect(preview).toEqual([
      { path: "README.md", type: "create_file", description: "create file" },
      { path: "src/app.ts", type: "update_file", description: "replace file contents" },
      { path: "README.md", type: "append_file", description: "append to file" },
    ]);
  });

  it("JSON validation catches malformed JSON", () => {
    const inspection = inspectWorkerPlanJsonInput({
      text: '{"runId": "run-1",',
      currentRunId: "run-1",
      taskTitle: "README smoke task",
      taskDescription: "Create README.md",
    });

    expect(inspection.jsonStatus).toBe("invalid");
    expect(inspection.parseError).toBe("This is not valid worker-plan JSON.");
  });

  it("JSON validation catches shell wrapper text", () => {
    const inspection = inspectWorkerPlanJsonInput({
      text: "cat <<'JSON'\n{\"runId\":\"run-1\"}\nJSON\npbcopy",
      currentRunId: "run-1",
      taskTitle: "README smoke task",
      taskDescription: "Create README.md",
    });

    expect(inspection.jsonStatus).toBe("invalid");
    expect(inspection.shellWrapperWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("cat <<'JSON'"),
        expect.stringContaining("pbcopy"),
      ]),
    );
  });

  it("placeholder runId warning appears", () => {
    const inspection = inspectWorkerPlanJsonInput({
      text: JSON.stringify({
        runId: "PASTE_NEW_RUN_ID_HERE",
        summary: "Create README note",
        allowedFiles: ["README.md"],
        operations: [
          {
            type: "create_file",
            path: "README.md",
            content: "note\n",
            reason: "smoke",
          },
        ],
      }),
      currentRunId: "run-1",
      taskTitle: "README smoke task",
      taskDescription: "Create README.md",
    });

    expect(inspection.jsonStatus).toBe("valid");
    expect(inspection.placeholderWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("PASTE_NEW_RUN_ID_HERE"),
        expect.stringContaining("current runId is run-1"),
      ]),
    );
  });

  it("task-vs-plan mismatch warning appears for README task touching src/example", () => {
    const analysis = analyzeWorkerPlanIntent({
      taskTitle: "Create README smoke verification",
      taskDescription: "Create README.md for staging verification.",
      plan: {
        runId: "run-1",
        summary: "Create example source file",
        allowedFiles: ["src/example/file.ts"],
        operations: [
          {
            type: "create_file",
            path: "src/example/file.ts",
            content: "export const demo = true;\n",
            reason: "mock output",
          },
        ],
      },
    });

    expect(analysis.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("non-README paths"),
        expect.stringContaining("This draft may not match the task. Review before execution."),
      ]),
    );
  });

  it("model draft comparison renders", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerPlanDraftPanel, {
        runId: "run-1",
        taskTitle: "Create README smoke verification",
        taskDescription: "Create README.md for staging verification.",
        initialDraft: {
          id: "draft-1",
          runId: "run-1",
          provider: "mock",
          model: "mock-worker-plan-v1",
          validationStatus: "valid",
          parsedPlan: {
            runId: "run-1",
            summary: "Create example source file",
            allowedFiles: ["src/example/file.ts"],
            operations: [
              {
                type: "create_file",
                path: "src/example/file.ts",
                content: "export const demo = true;\n",
                reason: "mock output",
              },
            ],
          },
          rawResponse: "{}",
          validationErrors: [],
          createdAt: "2026-05-25T00:00:00.000Z",
        },
        onUseDraftPlan: vi.fn(),
      }),
    );

    expect(html).toContain("This draft may not match the task. Review before execution.");
    expect(html).toContain("Create README smoke verification");
    expect(html).toContain("src/example/file.ts");
  });

  it("existing backend worker-plan validation still runs", () => {
    const result = validateWorkerPlanPayload(
      {
        runId: "wrong-run",
        summary: "Create README note",
        allowedFiles: ["README.md"],
        operations: [
          {
            type: "create_file",
            path: "README.md",
            content: "note\n",
            reason: "smoke",
          },
        ],
      },
      "/tmp/repo",
      "run-expected",
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RUN_ID_MISMATCH" }),
      ]),
    );
  });

  it("rendering the guided builder does not execute a worker plan automatically", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerPlanPanel, {
        runId: "run-1",
        taskTitle: "Create README smoke verification",
        taskDescription: "Create README.md for staging verification.",
        showReadmeSmokeHelper: true,
      }),
    );

    expect(html).toContain("Guided worker-plan builder");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
