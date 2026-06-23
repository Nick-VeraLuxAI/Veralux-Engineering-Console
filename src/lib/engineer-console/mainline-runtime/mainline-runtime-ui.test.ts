import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainlineRuntimeProofPanel } from "@/components/engineer-console/mainline-runtime-proof-panel";
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
