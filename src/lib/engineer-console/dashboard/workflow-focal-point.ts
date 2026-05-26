import {
  getDefaultWorkflowCanvasLayout,
  getWorkflowCanvasNodeRect,
  type WorkflowCanvasPoint,
} from "./workflow-canvas-layout";
import type {
  DashboardWorkflowIssue,
  WorkflowMapNode,
  WorkflowMapNodeId,
  WorkflowMapTone,
} from "./workflow-map";

export type WorkflowFocusReason = "selected-node" | "featured-issue" | "current-stage";

export interface WorkflowFocalPoint {
  focalNodeId: WorkflowMapNodeId;
  focalTone: WorkflowMapTone;
  focusReason: WorkflowFocusReason;
  worldCenter: WorkflowCanvasPoint;
}

const WORKFLOW_PROGRESS_ORDER: WorkflowMapNodeId[] = [
  "setup",
  "repository",
  "task",
  "run",
  "review",
  "pr",
  "release",
  "audit",
];

function orderForNode(nodeId: WorkflowMapNodeId) {
  return WORKFLOW_PROGRESS_ORDER.indexOf(nodeId);
}

function findCurrentWorkflowStage(nodes: WorkflowMapNode[]): WorkflowMapNode {
  const byProgress = [...nodes].sort((left, right) => orderForNode(right.id) - orderForNode(left.id));
  return (
    byProgress.find((node) => node.issueCount > 0) ??
    byProgress.find((node) => node.tone === "active" || node.tone === "warning" || node.tone === "blocked") ??
    byProgress.find((node) => node.tone !== "inactive") ??
    nodes[0]
  );
}

export function deriveWorkflowFocalPoint(input: {
  nodes: WorkflowMapNode[];
  selectedNodeId?: WorkflowMapNodeId | null;
  featuredIssue?: DashboardWorkflowIssue | null;
  featuredIssueNodeId?: WorkflowMapNodeId | null;
  layout?: Record<WorkflowMapNodeId, WorkflowCanvasPoint>;
}): WorkflowFocalPoint {
  const layout = input.layout ?? getDefaultWorkflowCanvasLayout();
  const nodesById = Object.fromEntries(input.nodes.map((node) => [node.id, node])) as Record<
    WorkflowMapNodeId,
    WorkflowMapNode
  >;

  let focalNodeId: WorkflowMapNodeId;
  let focusReason: WorkflowFocusReason;

  if (input.selectedNodeId) {
    focalNodeId = input.selectedNodeId;
    focusReason = "selected-node";
  } else if (input.featuredIssueNodeId ?? input.featuredIssue?.nodeId) {
    focalNodeId = (input.featuredIssueNodeId ?? input.featuredIssue?.nodeId)!;
    focusReason = "featured-issue";
  } else {
    focalNodeId = findCurrentWorkflowStage(input.nodes).id;
    focusReason = "current-stage";
  }

  const rect = getWorkflowCanvasNodeRect(layout, focalNodeId);
  return {
    focalNodeId,
    focalTone: nodesById[focalNodeId]?.tone ?? "inactive",
    focusReason,
    worldCenter: {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    },
  };
}
