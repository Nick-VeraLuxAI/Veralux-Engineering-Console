"use client";

import { usePathname, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowCameraRequest, WorkflowCameraTarget } from "@/lib/engineer-console/dashboard/workflow-camera";
import {
  bringCanvasOverlayToFront,
  closeCanvasOverlay,
  createCanvasOverlayStateMap,
  getMinimizedCanvasOverlays,
  getTopCanvasOverlay,
  minimizeCanvasOverlay,
  moveCanvasOverlay,
  openCanvasOverlay,
  restoreCanvasOverlay,
  updateCanvasOverlay,
  type CanvasOverlayId,
} from "@/lib/engineer-console/dashboard/canvas-overlays";
import { type DashboardWorkflowIssue, type EngineeringWorkflowMapData, type WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";
import { CanvasBottomDock } from "./canvas-bottom-dock";
import { CanvasDetailDrawer } from "./canvas-detail-drawer";
import { CanvasFloatingMenu } from "./canvas-floating-menu";
import { CanvasIssueCard } from "./canvas-issue-card";
import { CanvasMinimizedBar } from "./canvas-minimized-bar";
import { CanvasNodeInspector } from "./canvas-node-inspector";
import { CanvasTopBar, type CanvasTopBarTabId } from "./canvas-top-bar";
import { DashboardIssueCenter, routeDashboardIssue } from "./dashboard-issue-center";
import { WorkflowCanvas } from "./workflow-canvas";

type DetailPanelId = "setup" | "queue" | "tasks" | "staging" | "activity" | "docs" | null;
type DetailSnapshot = {
  panel: Exclude<DetailPanelId, null>;
  title: string;
  content: React.ReactNode;
};

function dockActiveId(detailPanel: DetailPanelId) {
  if (detailPanel === "activity") return "activity";
  if (detailPanel === "tasks") return "tasks";
  if (detailPanel === "docs") return "docs";
  if (detailPanel === "queue") return "runs";
  return "workflow";
}

function titleForDetailPanel(detailPanel: Exclude<DetailPanelId, null>) {
  switch (detailPanel) {
    case "setup":
      return "Setup details";
    case "queue":
      return "Operator queue";
    case "tasks":
      return "Task details";
    case "staging":
      return "Staging checklist";
    case "activity":
      return "Activity";
    case "docs":
      return "Docs";
  }
}

function tabForDetailPanel(detailPanel: DetailPanelId): CanvasTopBarTabId {
  if (detailPanel === "activity") return "activity";
  if (detailPanel === "docs") return "docs";
  if (detailPanel === "tasks") return "tasks";
  if (detailPanel === "setup" || detailPanel === "staging") return "settings";
  return "architecture";
}

function dockIdForNode(nodeId: WorkflowMapNodeId): string {
  switch (nodeId) {
    case "repository":
      return "repos";
    case "task":
      return "tasks";
    case "run":
      return "runs";
    case "review":
      return "reviews";
    case "release":
      return "release";
    default:
      return "workflow";
  }
}

function contextForNode(nodeId: WorkflowMapNodeId): CanvasTopBarTabId {
  switch (nodeId) {
    case "setup":
      return "settings";
    case "repository":
      return "repositories";
    case "task":
      return "tasks";
    case "run":
      return "runs";
    case "review":
      return "reviews";
    case "release":
      return "release";
    default:
      return "architecture";
  }
}

export function EngineeringConsoleCanvasHome({
  mapData,
  detailPanel,
  environmentLabel,
  children,
}: {
  mapData: EngineeringWorkflowMapData;
  detailPanel: DetailPanelId;
  environmentLabel: string;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const focusSequenceRef = useRef(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<WorkflowMapNodeId>(mapData.defaultSelectedNodeId);
  const [activeTab, setActiveTab] = useState<CanvasTopBarTabId>(tabForDetailPanel(detailPanel));
  const [activeDockId, setActiveDockId] = useState(dockActiveId(detailPanel));
  const [cameraRequest, setCameraRequest] = useState<WorkflowCameraRequest | null>(null);
  const [dismissedDetailPanel, setDismissedDetailPanel] = useState<DetailPanelId>(null);
  const [minimizedDetail, setMinimizedDetail] = useState<DetailSnapshot | null>(null);
  const [restoredDetail, setRestoredDetail] = useState<DetailSnapshot | null>(null);
  const [overlayStates, setOverlayStates] = useState(() => {
    let next = createCanvasOverlayStateMap({
      "issue-center": mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
      "node-inspector": mapData.inspectors[mapData.defaultSelectedNodeId].title,
      "detail-drawer": detailPanel ? titleForDetailPanel(detailPanel) : "Details",
      "priority-issue": mapData.featuredIssue?.title ?? "Priority issue",
    });
    next = openCanvasOverlay(next, "node-inspector", {
      title: mapData.inspectors[mapData.defaultSelectedNodeId].title,
    });
    if (mapData.featuredIssue) {
      next = openCanvasOverlay(next, "priority-issue", {
        title: mapData.featuredIssue.title,
      });
    }
    if (detailPanel) {
      next = openCanvasOverlay(next, "detail-drawer", {
        title: titleForDetailPanel(detailPanel),
      });
    }
    return next;
  });
  const selectedInspector = useMemo(
    () => mapData.inspectors[selectedNodeId],
    [mapData.inspectors, selectedNodeId],
  );
  const routeDetail = useMemo(
    () =>
      detailPanel && dismissedDetailPanel !== detailPanel && children
        ? {
            panel: detailPanel,
            title: titleForDetailPanel(detailPanel),
            content: children,
          }
        : null,
    [children, detailPanel, dismissedDetailPanel],
  );
  const visibleDetail = routeDetail ?? restoredDetail;
  const topOverlay = useMemo(() => getTopCanvasOverlay(overlayStates), [overlayStates]);
  const minimizedOverlays = useMemo(() => {
    return getMinimizedCanvasOverlays(overlayStates).filter(
      (overlay) => overlay.id !== "detail-drawer" || minimizedDetail !== null,
    );
  }, [minimizedDetail, overlayStates]);
  const featuredIssue = mapData.featuredIssue;
  const isTopOverlay = useCallback(
    (overlayId: CanvasOverlayId) => topOverlay?.id === overlayId,
    [topOverlay],
  );

  useLayoutEffect(() => {
    setCanvasReady(true);
  }, []);

  const activeDetailPanel = visibleDetail?.panel ?? detailPanel;
  const updateDetailUrl = useCallback(
    (nextDetailPanel: Exclude<DetailPanelId, null> | null) => {
      if (typeof window === "undefined") return;
      const nextQuery = new URLSearchParams(window.location.search);
      if (nextDetailPanel) {
        nextQuery.set("details", nextDetailPanel);
      } else {
        nextQuery.delete("details");
      }
      nextQuery.delete("tab");
      const nextUrl = nextQuery.toString() ? `${pathname}?${nextQuery.toString()}` : pathname;
      window.history.replaceState(window.history.state, "", nextUrl);
    },
    [pathname],
  );
  const requestCameraFocus = useCallback((target: WorkflowCameraTarget, motion: "smooth" | "instant" = "smooth") => {
    focusSequenceRef.current += 1;
    setCameraRequest({
      sequence: focusSequenceRef.current,
      target,
      motion,
    });
  }, []);
  const navigateToDetailPanel = useCallback(
    (panel: Exclude<DetailPanelId, null>) => {
      const nextUrl = `${pathname}?details=${panel}#canvas-detail-drawer`;
      if (typeof window !== "undefined") {
        window.location.assign(nextUrl);
        return;
      }
      router.push(nextUrl);
    },
    [pathname, router],
  );
  const bringToFront = useCallback((overlayId: CanvasOverlayId) => {
    setOverlayStates((current) => bringCanvasOverlayToFront(current, overlayId));
  }, []);
  const moveOverlayWindow = useCallback(
    (overlayId: CanvasOverlayId, position: { x: number; y: number }) => {
      setOverlayStates((current) => moveCanvasOverlay(current, overlayId, position));
    },
    [],
  );
  const closePriorityIssue = useCallback(() => {
    setOverlayStates((current) => closeCanvasOverlay(current, "priority-issue"));
  }, []);
  const openIssueCenter = useCallback(() => {
    setOverlayStates((current) =>
      openCanvasOverlay(current, "issue-center", {
        title: mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
      }),
    );
  }, [mapData.issues.length]);
  const closeIssueCenter = useCallback(() => {
    setOverlayStates((current) => closeCanvasOverlay(current, "issue-center"));
  }, []);
  const minimizeIssueCenter = useCallback(() => {
    setOverlayStates((current) => minimizeCanvasOverlay(current, "issue-center"));
  }, []);
  const closeInspector = useCallback(() => {
    setOverlayStates((current) => closeCanvasOverlay(current, "node-inspector"));
  }, []);
  const minimizeInspector = useCallback(() => {
    setOverlayStates((current) => minimizeCanvasOverlay(current, "node-inspector"));
  }, []);
  const closeDetailOverlay = useCallback(() => {
    if (routeDetail) {
      setDismissedDetailPanel(routeDetail.panel);
    }
    if (restoredDetail) {
      setRestoredDetail(null);
    }
    updateDetailUrl(null);
    setOverlayStates((current) => closeCanvasOverlay(current, "detail-drawer"));
  }, [restoredDetail, routeDetail, updateDetailUrl]);
  const minimizeDetailOverlay = useCallback(() => {
    if (!visibleDetail) return;
    setMinimizedDetail(visibleDetail);
    if (routeDetail) {
      setDismissedDetailPanel(visibleDetail.panel);
    } else {
      setRestoredDetail(null);
    }
    updateDetailUrl(null);
    setOverlayStates((current) => minimizeCanvasOverlay(current, "detail-drawer"));
  }, [routeDetail, updateDetailUrl, visibleDetail]);
  const restoreMinimizedOverlay = useCallback(
    (overlayId: CanvasOverlayId) => {
      if (overlayId === "issue-center") {
        setOverlayStates((current) =>
          restoreCanvasOverlay(current, "issue-center", {
            title: mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
          }),
        );
        return;
      }

      if (overlayId === "node-inspector") {
        setOverlayStates((current) =>
          restoreCanvasOverlay(current, "node-inspector", {
            title: selectedInspector.title,
          }),
        );
        return;
      }

      if (overlayId === "detail-drawer" && minimizedDetail) {
        setDismissedDetailPanel(null);
        setRestoredDetail(minimizedDetail);
        setMinimizedDetail(null);
        updateDetailUrl(minimizedDetail.panel);
        setOverlayStates((current) =>
          restoreCanvasOverlay(current, "detail-drawer", {
            title: minimizedDetail.title,
          }),
        );
      }
    },
    [mapData.issues.length, minimizedDetail, selectedInspector.title, updateDetailUrl],
  );
  const closeMinimizedOverlay = useCallback(
    (overlayId: CanvasOverlayId) => {
      if (overlayId === "detail-drawer") {
        if (minimizedDetail) {
          setDismissedDetailPanel(minimizedDetail.panel);
        }
        setMinimizedDetail(null);
        setRestoredDetail(null);
        updateDetailUrl(null);
      }
      setOverlayStates((current) => closeCanvasOverlay(current, overlayId));
    },
    [minimizedDetail, updateDetailUrl],
  );
  const focusNode = useCallback(
    (
      nodeId: WorkflowMapNodeId,
      options: {
        tab?: CanvasTopBarTabId;
        dockId?: string;
        motion?: "smooth" | "instant";
        focus?: boolean;
      } = {},
    ) => {
      setSelectedNodeId(nodeId);
      setActiveTab(options.tab ?? contextForNode(nodeId));
      setActiveDockId(options.dockId ?? dockIdForNode(nodeId));
      setOverlayStates((current) =>
        restoreCanvasOverlay(current, "node-inspector", {
          title: mapData.inspectors[nodeId].title,
        }),
      );
      if (options.focus !== false) {
        requestCameraFocus({ kind: "node", nodeId }, options.motion ?? "smooth");
      }
    },
    [mapData.inspectors, requestCameraFocus],
  );
  const focusActivityRegion = useCallback(() => {
    setActiveTab("activity");
    setActiveDockId("activity");
    requestCameraFocus({ kind: "activity" });
  }, [requestCameraFocus]);
  const focusArchitectureOverview = useCallback(() => {
    setActiveTab("architecture");
    setActiveDockId("workflow");
    requestCameraFocus({ kind: "fit" });
  }, [requestCameraFocus]);
  const handleDockActivate = useCallback(
    (dockId: string) => {
      switch (dockId) {
        case "workflow":
          focusArchitectureOverview();
          break;
        case "repos":
          focusNode("repository", { tab: "repositories", dockId: "repos" });
          break;
        case "tasks":
          focusNode("task", { tab: "tasks", dockId: "tasks" });
          break;
        case "runs":
          focusNode("run", { tab: "runs", dockId: "runs" });
          break;
        case "reviews":
          focusNode("review", { tab: "reviews", dockId: "reviews" });
          break;
        case "release":
          focusNode("release", { tab: "release", dockId: "release" });
          break;
        case "activity":
          focusActivityRegion();
          navigateToDetailPanel("activity");
          break;
        case "docs":
          setActiveTab("docs");
          setActiveDockId("docs");
          navigateToDetailPanel("docs");
          break;
      }
    },
    [focusActivityRegion, focusArchitectureOverview, focusNode, navigateToDetailPanel],
  );
  const handleSelectNode = useCallback(
    (nodeId: WorkflowMapNodeId, intent: "node-click" | "node-pointerdown" = "node-click") => {
      focusNode(nodeId, {
        focus: intent !== "node-pointerdown",
        motion: intent === "node-pointerdown" ? "instant" : "smooth",
      });
    },
    [focusNode],
  );
  const handleOpenIssue = useCallback(
    (issue: DashboardWorkflowIssue) => {
      routeDashboardIssue(issue, (nodeId) => {
        focusNode(nodeId, { focus: false, motion: "instant" });
      });
    },
    [focusNode],
  );

  useEffect(() => {
    setOverlayStates((current) =>
      updateCanvasOverlay(current, "node-inspector", {
        title: selectedInspector.title,
      }),
    );
  }, [selectedInspector.title]);

  useEffect(() => {
    setOverlayStates((current) =>
      updateCanvasOverlay(current, "issue-center", {
        title: mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
      }),
    );
  }, [mapData.issues.length]);

  useEffect(() => {
    if (featuredIssue) {
      setOverlayStates((current) =>
        openCanvasOverlay(current, "priority-issue", {
          title: featuredIssue.title,
        }),
      );
    } else {
      setOverlayStates((current) => closeCanvasOverlay(current, "priority-issue"));
    }
  }, [featuredIssue]);

  useEffect(() => {
    if (detailPanel && children && dismissedDetailPanel !== detailPanel) {
      setDismissedDetailPanel(null);
      setRestoredDetail(null);
      setMinimizedDetail((current) => (current?.panel === detailPanel ? null : current));
      setOverlayStates((current) =>
        openCanvasOverlay(current, "detail-drawer", {
          title: titleForDetailPanel(detailPanel),
        }),
      );
      return;
    }

    if (!restoredDetail && !minimizedDetail) {
      setOverlayStates((current) => closeCanvasOverlay(current, "detail-drawer"));
    }
  }, [children, detailPanel, dismissedDetailPanel, minimizedDetail, restoredDetail]);

  useEffect(() => {
    if (!activeDetailPanel) {
      return;
    }

    setActiveTab(tabForDetailPanel(activeDetailPanel));
    if (activeDetailPanel === "activity") {
      setActiveDockId("activity");
      return;
    }
    if (activeDetailPanel === "tasks") {
      setActiveDockId("tasks");
      return;
    }
    if (activeDetailPanel === "docs") {
      setActiveDockId("docs");
      return;
    }
    setActiveDockId("workflow");
  }, [activeDetailPanel]);

  useEffect(() => {
    if (!activeDetailPanel && (activeTab === "settings" || activeTab === "docs")) {
      setActiveTab("architecture");
      setActiveDockId("workflow");
    }
  }, [activeDetailPanel, activeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }

      const currentTopOverlay = getTopCanvasOverlay(overlayStates);
      if (!currentTopOverlay) return;

      event.preventDefault();
      switch (currentTopOverlay.id) {
        case "detail-drawer":
          closeDetailOverlay();
          break;
        case "issue-center":
          closeIssueCenter();
          break;
        case "node-inspector":
          closeInspector();
          break;
        case "priority-issue":
          closePriorityIssue();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeDetailOverlay,
    closeInspector,
    closeIssueCenter,
    closePriorityIssue,
    menuOpen,
    overlayStates,
  ]);

  const inspectorOpen = overlayStates["node-inspector"].isOpen && !overlayStates["node-inspector"].isMinimized;
  const quietPriorityIssueCard =
    inspectorOpen && mapData.featuredIssue?.severity !== "critical" && overlayStates["priority-issue"].isOpen;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#03060b] text-white"
      data-engineering-canvas-ready={canvasReady ? "true" : "false"}
      data-engineering-immersive-shell="true"
      data-engineering-immersive-root="true"
    >
      <main className="relative h-full overflow-hidden">
        <div className="absolute inset-0">
          <WorkflowCanvas
            nodes={mapData.nodes}
            selectedNodeId={selectedNodeId}
            featuredIssueNodeId={mapData.featuredIssue?.nodeId ?? null}
            cameraRequest={cameraRequest}
            hasMinimizedBar={minimizedOverlays.length > 0}
            onSelectNode={handleSelectNode}
          />
        </div>

        <CanvasFloatingMenu open={menuOpen} onOpenChange={setMenuOpen} />
        <CanvasTopBar
          activeContext={activeTab}
          issueCount={mapData.issues.length}
          environmentLabel={environmentLabel}
          onOpenQueue={() => navigateToDetailPanel("queue")}
        />

        <CanvasIssueCard
          issue={mapData.featuredIssue}
          onOpenIssue={handleOpenIssue}
          overlayState={overlayStates["priority-issue"]}
          isTopmost={isTopOverlay("priority-issue")}
          subdued={quietPriorityIssueCard}
          onClose={closePriorityIssue}
          onBringToFront={() => bringToFront("priority-issue")}
          onMove={(position) => moveOverlayWindow("priority-issue", position)}
        />

        <CanvasNodeInspector
          inspector={selectedInspector}
          overlayState={overlayStates["node-inspector"]}
          isTopmost={isTopOverlay("node-inspector")}
          onClose={closeInspector}
          onMinimize={minimizeInspector}
          onBringToFront={() => bringToFront("node-inspector")}
          onMove={(position) => moveOverlayWindow("node-inspector", position)}
        />

        <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <CanvasBottomDock links={mapData.dockLinks} activeId={activeDockId} onActivateLink={handleDockActivate} />
        </div>

        <CanvasMinimizedBar
          overlays={minimizedOverlays}
          onRestore={restoreMinimizedOverlay}
          onClose={closeMinimizedOverlay}
        />

        {visibleDetail ? (
          <CanvasDetailDrawer
            detailPanel={visibleDetail.panel}
            title={visibleDetail.title}
            onClose={closeDetailOverlay}
            onMinimize={minimizeDetailOverlay}
            zIndex={overlayStates["detail-drawer"].zIndex}
            isTopmost={isTopOverlay("detail-drawer")}
            onBringToFront={() => bringToFront("detail-drawer")}
          >
            {visibleDetail.content}
          </CanvasDetailDrawer>
        ) : null}

        <DashboardIssueCenter
          issues={mapData.issues}
          onOpenIssue={handleOpenIssue}
          overlayState={overlayStates["issue-center"]}
          isTopmost={isTopOverlay("issue-center")}
          onExpand={openIssueCenter}
          onClose={closeIssueCenter}
          onMinimize={minimizeIssueCenter}
          onBringToFront={() => bringToFront("issue-center")}
          onMove={(position) => moveOverlayWindow("issue-center", position)}
        />
      </main>
    </div>
  );
}
