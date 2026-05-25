import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunSectionGroup } from "@/components/engineer-console/run-section-group";
import type { RunSectionGroupState } from "./run-ux-types";

function buildState(
  overrides: Partial<RunSectionGroupState> = {},
): RunSectionGroupState {
  return {
    id: "technical_audit",
    title: "Technical Audit",
    description: "Append-only audit history and raw technical details.",
    currentStateLabel: "Audit chain is healthy.",
    nextActionLabel: "Open this group when you need deeper diagnostics.",
    defaultExpanded: false,
    tone: "neutral",
    panelIds: ["audit-timeline"],
    ...overrides,
  };
}

describe("RunSectionGroup", () => {
  it("renders a collapsed state with an accessible toggle button", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RunSectionGroup,
        {
          state: buildState(),
          anchorId: "technical-audit",
        },
        React.createElement("div", null, "Audit timeline"),
      ),
    );

    expect(html).toContain("Technical Audit");
    expect(html).toContain("Show details");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Audit timeline");
  });

  it("renders an expanded state with hide details copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RunSectionGroup,
        {
          state: buildState({ defaultExpanded: true, tone: "warning" }),
          anchorId: "technical-audit",
        },
        React.createElement("div", null, "Audit timeline"),
      ),
    );

    expect(html).toContain("Hide details");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Audit timeline");
  });
});
