import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  GOVERNED_CHANGE_DEMO_ENDPOINT,
  MainlineRuntimeProofPanel,
  MainlineRuntimeGovernedChangePanelStatus,
  MainlineRuntimeProofPanelStatus,
  SAFE_MAINLINE_DEMO_ENDPOINT,
  triggerGovernedChangeDemo,
  triggerSafeMainlineDemo,
} from "@/components/engineer-console/mainline-runtime-proof-panel";
import { runMainlineGovernedChangeDemo } from "./mainline-governed-change-demo";
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

describe("Phase 27 governed change demo UI action", () => {
  it("renders the Run Governed Change Demo button without arbitrary path inputs", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeProofPanel, {
        proof: buildMainlineTaskRunProof({ env: {} as NodeJS.ProcessEnv }),
      }),
    );

    expect(html).toContain("Run Governed Change Demo");
    expect(html).toContain('data-governed-demo-trigger="true"');
    expect(html).toContain('data-governed-demo-state="idle"');
    expect(html).not.toContain("docPath");
    expect(html).not.toContain("evidencePath");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("governed change action calls the governed-change API endpoint with POST", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "governed_code_change_api_ui_trigger_passed_awaiting_user_approval",
      proof: await runMainlineGovernedChangeDemo({ writeFiles: false }),
    }), { status: 200 })) as unknown as typeof fetch;

    await triggerGovernedChangeDemo(fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(GOVERNED_CHANGE_DEMO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("renders governed loading state while pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeGovernedChangePanelStatus, {
        actionState: "running",
        demoProof: null,
        errorMessage: null,
      }),
    );

    expect(html).toContain('data-governed-demo-state="running"');
    expect(html).toContain("Running governed change demo");
  });

  it("renders governed success state with changed files, checks, approval, and safety fields", async () => {
    const demoProof = await runMainlineGovernedChangeDemo({ writeFiles: false });
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeGovernedChangePanelStatus, {
        actionState: "success",
        demoProof,
        errorMessage: null,
      }),
    );

    expect(html).toContain('data-governed-demo-state="success"');
    expect(html).toContain("Governed change demo completed safely");
    expect(html).toContain("awaiting_user_approval");
    expect(html).toContain("docs/runtime/phase-26-governed-code-change-demo.md");
    expect(html).toContain("evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md");
    expect(html).toContain("Checks recorded");
    expect(html).toContain("Approval required");
    expect(html).toContain("Integration performed");
    expect(html).toContain("PR created");
    expect(html).toContain("Merge performed");
    expect(html).toContain("Fallback used");
    expect(html).toContain("Qwen used");
    expect(html).toContain("Super required");
    expect(html).toContain("Mixtral required");
    expect(html).toContain("AirLLM used");
    expect(html).toContain("false");
    expect(html).toContain("true");
  });

  it("renders governed error state without fallback or escalation language", () => {
    const html = renderToStaticMarkup(
      React.createElement(MainlineRuntimeGovernedChangePanelStatus, {
        actionState: "error",
        demoProof: null,
        errorMessage: "API failed",
      }),
    );

    expect(html).toContain('data-governed-demo-state="error"');
    expect(html).toContain("Governed change demo did not complete.");
    expect(html).toContain("API failed");
    expect(html).toContain("No fallback, senior escalation, retry escalation, PR, merge, or integration was triggered.");
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
