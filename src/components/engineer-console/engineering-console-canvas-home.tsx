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
import { summarizeMapForChat } from "@/lib/engineer-console/dashboard/map-chat";
import type { RepoFolderContract } from "@/lib/engineer-console/dashboard/repo-control-plane";
import {
  clampMapChatDockSize,
  defaultMapChatDockSize,
  loadMapChatDockSize,
  readVisibleViewport,
  saveMapChatDockSize,
  type MapChatDockSize,
} from "@/lib/engineer-console/dashboard/map-chat-frame";
import type { MapChatThreadFocus } from "@/lib/engineer-console/dashboard/map-chat-threads";
import { type DashboardWorkflowIssue, type EngineeringWorkflowMapData, type WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";
import { CanvasBottomDock } from "./canvas-bottom-dock";
import { CanvasDetailDrawer } from "./canvas-detail-drawer";
import { CanvasFloatingMenu } from "./canvas-floating-menu";
import { CanvasIssueCard } from "./canvas-issue-card";
import { CanvasMinimizedBar } from "./canvas-minimized-bar";
import { CanvasNodeInspector } from "./canvas-node-inspector";
import { CanvasMapChat } from "./canvas-map-chat";
import { CanvasStageTabBar } from "./canvas-stage-tab-bar";
import {
  CanvasTopBar,
  loadCanvasWorkingRepoId,
  resolveCanvasWorkingRepo,
  saveCanvasWorkingRepoId,
  summarizeCanvasIssues,
  type CanvasTopBarTabId,
} from "./canvas-top-bar";
import { DashboardIssueCenter, routeDashboardIssue } from "./dashboard-issue-center";
import { RepoMapCanvas } from "./repo-map-canvas";
import { StartRepoForm } from "./start-repo-form";
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
  const focusedFromQueryRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<WorkflowMapNodeId>(mapData.defaultSelectedNodeId);
  const [selectedMappedRepoId, setSelectedMappedRepoId] = useState<string | null>(null);
  const [chatDock, setChatDock] = useState<MapChatDockSize>(() => defaultMapChatDockSize({ width: 1280, height: 800 }));
  const [mapSurface, setMapSurface] = useState<"workflow" | "repo">("workflow");
  const [stageTab, setStageTab] = useState("workflow");
  const [workbenchTabs, setWorkbenchTabs] = useState<Array<{ id: string; label: string }>>([]);
  const [dismissedWorkbenchIds, setDismissedWorkbenchIds] = useState<Set<string>>(() => new Set());
  const knownWorkbenchIdsRef = useRef<string[]>([]);
  const [startRepoOpen, setStartRepoOpen] = useState(false);
  const [repoContract, setRepoContract] = useState<RepoFolderContract | null>(null);
  const [activeTab, setActiveTab] = useState<CanvasTopBarTabId>(tabForDetailPanel(detailPanel));
  const [activeDockId, setActiveDockId] = useState(dockActiveId(detailPanel));
  const [cameraRequest, setCameraRequest] = useState<WorkflowCameraRequest | null>(null);
  const [dismissedDetailPanel, setDismissedDetailPanel] = useState<DetailPanelId>(null);
  const [minimizedDetail, setMinimizedDetail] = useState<DetailSnapshot | null>(null);
  const [restoredDetail, setRestoredDetail] = useState<DetailSnapshot | null>(null);
  const [overlayStates, setOverlayStates] = useState(() => {
    let next = createCanvasOverlayStateMap({
      "issue-center": mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
      "node-inspector": mapData.inspectors.run.title,
      "detail-drawer": detailPanel ? titleForDetailPanel(detailPanel) : "Details",
      "priority-issue": mapData.featuredIssue?.title ?? "Priority issue",
    });
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
  const workingRepo = useMemo(
    () => resolveCanvasWorkingRepo(mapData.mappedRepos, selectedMappedRepoId),
    [mapData.mappedRepos, selectedMappedRepoId],
  );
  const mapSummary = useMemo(
    () =>
      summarizeMapForChat({
        surface: mapSurface,
        nodes: mapData.nodes,
        repoName: workingRepo?.name,
        freshnessLabel: workingRepo?.control.freshnessLabel,
        contract: repoContract,
        runLabel: workingRepo?.control.runOverlay?.label ?? null,
      }),
    [mapData.nodes, mapSurface, repoContract, workingRepo],
  );
  const isTopOverlay = useCallback(
    (overlayId: CanvasOverlayId) => topOverlay?.id === overlayId,
    [topOverlay],
  );

  useLayoutEffect(() => {
    setChatDock(loadMapChatDockSize(readVisibleViewport()));
    setSelectedMappedRepoId(loadCanvasWorkingRepoId());
    setCanvasReady(true);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setChatDock((current) => clampMapChatDockSize(current, readVisibleViewport()));
    };
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  const updateChatDock = useCallback((next: MapChatDockSize) => {
    setChatDock(next);
  }, []);

  const commitChatDock = useCallback((next: MapChatDockSize) => {
    const clamped = clampMapChatDockSize(next, readVisibleViewport());
    setChatDock(clamped);
    saveMapChatDockSize(clamped);
  }, []);

  useEffect(() => {
    if (selectedMappedRepoId) saveCanvasWorkingRepoId(selectedMappedRepoId);
  }, [selectedMappedRepoId]);

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
      if (nodeId === "repository") {
        setMapSurface("repo");
        setStageTab("repo");
        setOverlayStates((current) => closeCanvasOverlay(current, "node-inspector"));
      } else {
        setMapSurface("workflow");
        setStageTab("workflow");
        setOverlayStates((current) =>
          restoreCanvasOverlay(current, "node-inspector", {
            title: mapData.inspectors[nodeId].title,
          }),
        );
      }
      if (options.focus !== false) {
        requestCameraFocus({ kind: "fit" }, options.motion ?? "smooth");
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
    setMapSurface("workflow");
    setStageTab("workflow");
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
  const snapMapToChatFocus = useCallback(
    (focus: MapChatThreadFocus, options: { revealRepo?: boolean } = {}) => {
      if (
        focus.nodeId === "run" ||
        focus.nodeId === "review" ||
        focus.nodeId === "pr" ||
        focus.nodeId === "release" ||
        focus.nodeId === "audit"
      ) {
        return;
      }
      setSelectedNodeId(focus.nodeId);
      if (focus.nodeId === "repository") {
        setActiveTab("repositories");
        setActiveDockId("repos");
      }
      if (options.revealRepo && focus.projectId?.startsWith("repo:")) {
        setSelectedMappedRepoId(focus.projectId.slice("repo:".length));
      }
      if (options.revealRepo && focus.nodeId === "repository") {
        setMapSurface("repo");
        setStageTab("repo");
      } else if (focus.nodeId !== "repository") {
        setMapSurface("workflow");
        setStageTab("workflow");
      }
      requestCameraFocus({ kind: "fit" });
    },
    [requestCameraFocus],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const startRepo = params.get("start") === "repo";
    if (startRepo) {
      setStartRepoOpen(true);
      setMapSurface("repo");
    }
    if (focusedFromQueryRef.current) return;
    if (params.get("focus") !== "repository" && !startRepo) return;
    focusedFromQueryRef.current = true;
    const repoId = params.get("repo");
    const mapped = repoId ? mapData.mappedRepos.find((repo) => repo.id === repoId) ?? null : null;
    const nextRepoId = mapped?.id ?? repoId;
    if (nextRepoId) saveCanvasWorkingRepoId(nextRepoId);
    setSelectedMappedRepoId(nextRepoId);
    snapMapToChatFocus(
      {
        nodeId: "repository",
        projectId: mapped ? `repo:${mapped.id}` : repoId ? `repo:${repoId}` : null,
        projectLabel: mapped?.name ?? null,
      },
      { revealRepo: true },
    );
  }, [mapData.mappedRepos, snapMapToChatFocus]);
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
    if (!featuredIssue) {
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

  const dismissWorkbenchTab = useCallback((id: string) => {
    setDismissedWorkbenchIds((current) => new Set([...current, id]));
    setStageTab((current) => (current === id ? "workflow" : current));
    setMapSurface("workflow");
  }, []);

  const openWorkbenchTab = useCallback((id: string) => {
    setDismissedWorkbenchIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setStageTab(id);
  }, []);

  const clearWorkbenchDismissals = useCallback(() => {
    setDismissedWorkbenchIds(new Set());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }

      if (stageTab !== "workflow" && stageTab !== "repo") {
        event.preventDefault();
        dismissWorkbenchTab(stageTab);
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
    dismissWorkbenchTab,
    menuOpen,
    overlayStates,
    stageTab,
  ]);

  const inspectorOpen = overlayStates["node-inspector"].isOpen && !overlayStates["node-inspector"].isMinimized;
  const issueCenterOpen = overlayStates["issue-center"].isOpen && !overlayStates["issue-center"].isMinimized;
  const priorityIssueOpen = overlayStates["priority-issue"].isOpen && !overlayStates["priority-issue"].isMinimized;
  const canStepBack =
    mapSurface === "repo" ||
    (stageTab !== "workflow" && stageTab !== "repo") ||
    Boolean(visibleDetail) ||
    inspectorOpen ||
    issueCenterOpen ||
    priorityIssueOpen ||
    menuOpen;
  const handleMapBack = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (stageTab !== "workflow" && stageTab !== "repo") {
      dismissWorkbenchTab(stageTab);
      return;
    }
    if (visibleDetail) {
      closeDetailOverlay();
      return;
    }
    if (issueCenterOpen) {
      closeIssueCenter();
      return;
    }
    if (priorityIssueOpen) {
      closePriorityIssue();
      return;
    }
    if (inspectorOpen) {
      closeInspector();
      return;
    }
    if (mapSurface === "repo") {
      focusArchitectureOverview();
    }
  }, [
    closeDetailOverlay,
    closeInspector,
    closeIssueCenter,
    closePriorityIssue,
    dismissWorkbenchTab,
    focusArchitectureOverview,
    inspectorOpen,
    issueCenterOpen,
    mapSurface,
    menuOpen,
    priorityIssueOpen,
    stageTab,
    visibleDetail,
  ]);
  const handleWorkbenchTabs = useCallback((tabs: Array<{ id: string; label: string }>) => {
    const ids = tabs.map((tab) => tab.id);
    const added = ids.filter((id) => !knownWorkbenchIdsRef.current.includes(id));
    knownWorkbenchIdsRef.current = ids;
    setWorkbenchTabs(tabs);
    if (added.length) {
      setStageTab(added[added.length - 1]);
      return;
    }
    setStageTab((current) =>
      current === "workflow" || current === "repo" || tabs.some((tab) => tab.id === current)
        ? current
        : "workflow",
    );
  }, []);
  const stageTabs = [
    { id: "workflow", label: "Workflow" },
    { id: "repo", label: workingRepo?.name || "Repo" },
    ...workbenchTabs.map((tab) => ({ ...tab, closable: true })),
  ];
  const workbenchActive = stageTab !== "workflow" && stageTab !== "repo";
  const quietPriorityIssueCard =
    inspectorOpen && mapData.featuredIssue?.severity !== "critical" && overlayStates["priority-issue"].isOpen;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#03060b] text-white"
      data-engineering-canvas-ready={canvasReady ? "true" : "false"}
      data-engineering-immersive-shell="true"
      data-engineering-immersive-root="true"
      data-canvas-workspace="split"
      style={
        {
          "--canvas-chat-rail": `${chatDock.width}px`,
          "--canvas-chat-sheet": `${chatDock.height}px`,
        } as React.CSSProperties
      }
    >
      <main className="flex h-full min-h-0 w-full flex-col overflow-hidden md:flex-row">
        <div
          data-canvas-chat-slot="true"
          className="relative z-20 order-2 flex h-[var(--canvas-chat-sheet)] min-h-0 w-full shrink-0 flex-col md:order-1 md:h-full md:w-[var(--canvas-chat-rail)]"
        >
          <CanvasMapChat
            layout="docked"
            dockSize={chatDock}
            onDockSizeChange={updateChatDock}
            onDockSizeCommit={commitChatDock}
            mapSummary={mapSummary}
            projects={mapData.projects}
            repos={mapData.mappedRepos.map((repo) => ({ id: repo.id, name: repo.name }))}
            workingRepo={workingRepo ? { id: workingRepo.id, name: workingRepo.name } : null}
            onWorkingRepoChange={(repoId) => {
              const mapped = mapData.mappedRepos.find((repo) => repo.id === repoId);
              snapMapToChatFocus(
                {
                  nodeId: "repository",
                  projectId: `repo:${repoId}`,
                  projectLabel: mapped?.name ?? null,
                },
                { revealRepo: true },
              );
            }}
            onSnapMap={snapMapToChatFocus}
            onStartRepo={() => {
              setMapSurface("repo");
              setStartRepoOpen(true);
            }}
            pendingApproval={mapData.pendingChatApproval}
            workbenchTabId={workbenchActive ? stageTab : null}
            dismissedWorkbenchIds={dismissedWorkbenchIds}
            onWorkbenchTabs={handleWorkbenchTabs}
            onDismissWorkbenchTab={dismissWorkbenchTab}
            onSelectWorkbenchTab={openWorkbenchTab}
            onClearWorkbenchDismissals={clearWorkbenchDismissals}
          />
        </div>

        <div
          data-canvas-stage="true"
          data-canvas-surface={mapSurface}
          className="relative order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:order-2"
        >
          <CanvasTopBar
            leading={<CanvasFloatingMenu placement="inline" open={menuOpen} onOpenChange={setMenuOpen} />}
            activeContext={activeTab}
            issueCount={mapData.issues.length}
            issueSummary={summarizeCanvasIssues(mapData.issues)}
            environmentLabel={environmentLabel}
            workingRepoLabel={workingRepo?.name}
            onOpenIssues={openIssueCenter}
            showBack={canStepBack}
            onBack={handleMapBack}
          />
          <CanvasStageTabBar
            tabs={stageTabs}
            activeId={stageTab}
            onSelect={(id) => {
              if (id === "workflow") {
                focusArchitectureOverview();
                return;
              }
              if (id === "repo") {
                focusNode("repository", { tab: "repositories", dockId: "repos", focus: false });
                return;
              }
              setStageTab(id);
            }}
            onClose={dismissWorkbenchTab}
            trailing={
              <button
                type="button"
                data-canvas-start-repo="true"
                className="rounded-full px-2.5 py-1 text-[12px] text-white/55 hover:text-white"
                onClick={() => {
                  focusNode("repository", { tab: "repositories", dockId: "repos", focus: false });
                  setStartRepoOpen(true);
                }}
              >
                Start a repo
              </button>
            }
          />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className={stageTab === "workflow" ? "h-full" : "hidden"} data-canvas-stage-pane="workflow">
              <WorkflowCanvas
                nodes={mapData.nodes}
                selectedNodeId={selectedNodeId}
                featuredIssueNodeId={mapData.featuredIssue?.nodeId ?? null}
                cameraRequest={cameraRequest}
                hasMinimizedBar={minimizedOverlays.length > 0}
                onSelectNode={handleSelectNode}
              />
            </div>
            <div className={stageTab === "repo" ? "h-full" : "hidden"} data-canvas-stage-pane="repo">
              <RepoMapCanvas repo={workingRepo} onSelectedContract={setRepoContract} />
            </div>
            <div
              data-canvas-workbench="true"
              data-canvas-workbench-active={workbenchActive ? "true" : "false"}
              className={workbenchActive ? "h-full bg-[#03060b]" : "hidden"}
            />
          </div>
          <div
            data-canvas-bottom-dock-slot="true"
            className="relative z-30 flex shrink-0 justify-center border-t border-white/8 bg-[#070a12] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4"
          >
            <CanvasBottomDock
              links={mapData.dockLinks}
              activeId={activeDockId}
              onActivateLink={handleDockActivate}
            />
          </div>
          {startRepoOpen && workingRepo ? (
            <div
              data-start-repo-overlay="true"
              className="pointer-events-none absolute inset-x-0 top-[6.5rem] z-40 flex justify-center px-3"
            >
              <div className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-[1.4rem] border border-white/8 bg-[#05070d]/92 p-4 shadow-[0_18px_34px_rgba(2,6,23,0.35)] backdrop-blur-xl">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    className="text-[11px] text-white/60 hover:text-white"
                    onClick={() => setStartRepoOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <StartRepoForm />
              </div>
            </div>
          ) : null}
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
            showCollapsedButton={false}
          />
        </div>
      </main>
    </div>
  );
}
