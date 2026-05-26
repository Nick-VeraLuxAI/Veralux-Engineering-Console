import { describe, expect, it } from "vitest";
import { getDefaultWorkflowCanvasLayout } from "./workflow-canvas-layout";
import { deriveWorkflowFocalPoint } from "./workflow-focal-point";
import type { DashboardWorkflowIssue, WorkflowMapNode } from "./workflow-map";

const BASE_NODES: WorkflowMapNode[] = [
  { id: "setup", label: "Setup", tone: "ready", state: "Ready", shortState: "Setup ready", issueCount: 0 },
  { id: "repository", label: "Repository", tone: "ready", state: "Verified", shortState: "Repo ready", issueCount: 0 },
  { id: "task", label: "Task", tone: "active", state: "Prepared", shortState: "Task ready", issueCount: 0 },
  { id: "run", label: "Run", tone: "warning", state: "Waiting approval", shortState: "Needs review", issueCount: 1 },
  { id: "review", label: "Review", tone: "inactive", state: "Not ready", shortState: "Await run", issueCount: 0 },
  { id: "pr", label: "PR", tone: "inactive", state: "Not ready", shortState: "Await review", issueCount: 0 },
  { id: "release", label: "Release", tone: "inactive", state: "Not started", shortState: "Await PR", issueCount: 0 },
  { id: "audit", label: "Audit", tone: "warning", state: "Attention", shortState: "Audit warning", issueCount: 1 },
];

const FEATURED_ISSUE: DashboardWorkflowIssue = {
  id: "issue-1",
  severity: "critical",
  title: "Audit chain verification failed",
  message: "Audit evidence needs review.",
  destination: "Audit workspace",
  suggestedAction: "Open audit.",
  href: "/engineer/runs/run-1#audit",
  nodeId: "audit",
  sortPriority: 100,
};

describe("workflow-focal-point", () => {
  it("prefers the selected node over all other focal candidates", () => {
    const focalPoint = deriveWorkflowFocalPoint({
      nodes: BASE_NODES,
      selectedNodeId: "run",
      featuredIssue: FEATURED_ISSUE,
    });

    expect(focalPoint.focalNodeId).toBe("run");
    expect(focalPoint.focusReason).toBe("selected-node");
  });

  it("falls back to the featured issue node when no selected node exists", () => {
    const focalPoint = deriveWorkflowFocalPoint({
      nodes: BASE_NODES,
      featuredIssue: FEATURED_ISSUE,
    });

    expect(focalPoint.focalNodeId).toBe("audit");
    expect(focalPoint.focusReason).toBe("featured-issue");
  });

  it("falls back to the current workflow stage when no selected node or issue exists", () => {
    const focalPoint = deriveWorkflowFocalPoint({
      nodes: BASE_NODES.map((node) => (node.id === "audit" ? { ...node, issueCount: 0, tone: "inactive" } : node)),
    });

    expect(focalPoint.focalNodeId).toBe("run");
    expect(focalPoint.focusReason).toBe("current-stage");
  });

  it("returns focal world coordinates for the chosen node", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const focalPoint = deriveWorkflowFocalPoint({
      nodes: BASE_NODES,
      selectedNodeId: "audit",
      layout,
    });

    expect(focalPoint.worldCenter.x).toBeGreaterThan(layout.audit.x);
    expect(focalPoint.worldCenter.y).toBeGreaterThan(layout.audit.y);
  });
});
