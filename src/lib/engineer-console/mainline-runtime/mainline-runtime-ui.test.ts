import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MainlineRuntimeProofPanel,
  MainlineRuntimeProofPanelStatus,
  SAFE_MAINLINE_DEMO_ENDPOINT,
  triggerSafeMainlineDemo,
} from "@/components/engineer-console/mainline-runtime-proof-panel";
import { runMainlineSafeTaskExecutionDemo } from "./mainline-safe-task-execution-demo";
import { buildMainlineTaskRunProof } from "./mainline-task-run-proof";

describe("Phase 22 mainline runtime dashboard panel", () => {
  it("renders the critical Nano mainline proof status fields", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanel, {
        proof: buildMainlineTaskRunProof({ env: {} as NodeJS.ProcessEnv }),
      }),
    );

    expect(html).toContain('data-mainline-runtime-proof-panel="true"');
    expect(html).toContain("Nano mainline runtime");
    expect(html).toContain("awaiting user approval");
    expect(html).toContain("Nemotron-Nano-30B-A3B-NVFP4 @ http://127.0.0.1:8081/v1");
    expect(html).toContain("Nemotron-Nano-30B-A3B-NVFP4 @ http://127.0.0.1:8082/v1");
    expect(html).toContain("Approval required");
    expect(html).toContain("Integration performed");
    expect(html).toContain("Fallback used");
    expect(html).toContain("Qwen used");
    expect(html).toContain("Senior required");
    expect(html).toContain("Production files changed");
    expect(html).toContain("Nemotron Super senior worker: blocked_unproven");
    expect(html).toContain("Mixtral cold senior reviewer: parked_experimental_offline_only");
  });
});

describe("Phase 25 safe mainline demo UI action", () => {
  it("renders the Run Safe Mainline Demo button without arbitrary path inputs", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanel, {
        proof: buildMainlineTaskRunProof({ env: {} as NodeJS.ProcessEnv }),
      }),
    );

    expect(html).toContain("Run Safe Mainline Demo");
    expect(html).toContain('data-safe-demo-trigger="true"');
    expect(html).toContain('data-safe-demo-state="idle"');
    expect(html).not.toContain("outputPath");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("safe demo action calls the Phase 24 endpoint with POST", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "safe_mainline_task_demo_api_trigger_passed_awaiting_user_approval",
      proof: await runMainlineSafeTaskExecutionDemo({ writeEvidence: false }),
    }), { status: 200 })) as unknown as typeof fetch;

    await triggerSafeMainlineDemo(fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(SAFE_MAINLINE_DEMO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("renders loading state while pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanelStatus, {
        actionState: "running",
        demoProof: null,
        errorMessage: null,
      }),
    );

    expect(html).toContain('data-safe-demo-state="running"');
    expect(html).toContain("Running safe mainline demo");
  });

  it("renders success state with approval, safety, and evidence fields", async () => {
    const demoProof = await runMainlineSafeTaskExecutionDemo({ writeEvidence: false });
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanelStatus, {
        actionState: "success",
        demoProof,
        errorMessage: null,
      }),
    );

    expect(html).toContain('data-safe-demo-state="success"');
    expect(html).toContain("Safe demo completed and evidence was packaged.");
    expect(html).toContain("awaiting_user_approval");
    expect(html).toContain("Approval required");
    expect(html).toContain("Integration performed");
    expect(html).toContain("Fallback used");
    expect(html).toContain("Qwen used");
    expect(html).toContain("Super required");
    expect(html).toContain("Mixtral required");
    expect(html).toContain("evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md");
    expect(html).toContain("false");
    expect(html).toContain("true");
  });

  it("renders safe error state without fallback or escalation language", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanelStatus, {
        actionState: "error",
        demoProof: null,
        errorMessage: "API failed",
      }),
    );

    expect(html).toContain('data-safe-demo-state="error"');
    expect(html).toContain("Safe demo did not complete.");
    expect(html).toContain("API failed");
    expect(html).toContain("No fallback, escalation, or integration was triggered.");
    expect(html).toContain("Approval remains required.");
  });
});
