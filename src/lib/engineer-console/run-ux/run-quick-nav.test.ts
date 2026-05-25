import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunQuickNav } from "@/components/engineer-console/run-quick-nav";
import { RunExpertSummary } from "@/components/engineer-console/run-expert-summary";

describe("RunQuickNav", () => {
  it("renders quick-nav anchors and keyboard help", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunQuickNav, {
        items: [
          {
            id: "current-action",
            label: "Current action",
            href: "#current-action",
            targetId: "current-action",
            tone: "ready",
            statusLabel: "approval",
          },
          {
            id: "pr",
            label: "PR",
            href: "#pr-creation",
            targetId: "pr-creation",
            tone: "warning",
            statusLabel: "retry",
            shortcutKey: "g p",
          },
          {
            id: "audit",
            label: "Audit",
            href: "#audit-timeline",
            targetId: "audit-timeline",
            tone: "blocked",
            statusLabel: "issues",
            shortcutKey: "g t",
          },
        ],
      }),
    );

    expect(html).toContain("Quick navigation");
    expect(html).toContain('href="#current-action"');
    expect(html).toContain('href="#pr-creation"');
    expect(html).toContain('href="#audit-timeline"');
    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain("Navigation only. No mutation shortcuts exist.");
  });
});

describe("RunExpertSummary", () => {
  it("renders a compact read-only summary strip", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunExpertSummary, {
        items: [
          { id: "run", label: "Run", status: "waiting_for_approval" },
          { id: "policy", label: "Policy", status: "passed" },
          { id: "pr", label: "PR", status: "pr_created" },
        ],
      }),
    );

    expect(html).toContain("Expert summary");
    expect(html).toContain("Read-only status strip for repeat operators.");
    expect(html).toContain("waiting for approval");
    expect(html).toContain("pr created");
  });
});
