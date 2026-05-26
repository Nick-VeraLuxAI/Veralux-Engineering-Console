"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import {
  closeCanvasOverlay,
  createCanvasOverlayStateMap,
  moveCanvasOverlay,
  openCanvasOverlay,
} from "@/lib/engineer-console/dashboard/canvas-overlays";
import {
  type EngineeringWorkflowMapData,
  type WorkflowMapNodeId,
} from "@/lib/engineer-console/dashboard/workflow-map";
import { DashboardIssueCenter, routeDashboardIssue } from "./dashboard-issue-center";
import { EngineeringWorkflowMap } from "./engineering-workflow-map";
import { WorkflowNodeInspector } from "./workflow-node-inspector";

function ActivityPanel({
  items,
}: {
  items: EngineeringWorkflowMapData["activityItems"];
}) {
  return (
    <section
      id="dashboard-activity"
      className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_18px_50px_rgba(15,23,42,0.22)]"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Activity</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Short operator-facing updates only. Full queue, setup, and audit detail stays behind
            explicit views.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">No recent workflow activity is available yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
              <p className="mt-2 text-sm text-white">{item.detail}</p>
              <Link
                href={item.href}
                className="mt-3 inline-flex text-sm font-medium text-[var(--accent)] underline underline-offset-2"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dock({
  links,
}: {
  links: EngineeringWorkflowMapData["dockLinks"];
}) {
  return (
    <nav
      className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
      aria-label="Dashboard surfaces"
    >
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3.5 py-2 text-sm text-[var(--muted)] transition hover:border-white/15 hover:text-white"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function EngineeringWorkflowHome({
  mapData,
  children,
}: {
  mapData: EngineeringWorkflowMapData;
  children: React.ReactNode;
}) {
  const [dashboardReady, setDashboardReady] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<WorkflowMapNodeId>(mapData.defaultSelectedNodeId);
  const [overlayStates, setOverlayStates] = useState(() =>
    createCanvasOverlayStateMap({
      "issue-center": mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
    }),
  );
  const selectedInspector = useMemo(
    () => mapData.inspectors[selectedNodeId],
    [mapData.inspectors, selectedNodeId],
  );

  useEffect(() => {
    setDashboardReady(true);
  }, []);

  return (
    <div
      className="space-y-6"
      data-engineer-dashboard-ready={dashboardReady ? "true" : "false"}
    >
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Engineering Console</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Visual workflow map for setup, tasks, governed runs, review, PR, and release follow-up.
          </p>
        </div>
        <Link
          href={mapData.primaryChip.href}
          className="rounded-2xl border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-left shadow-[0_16px_40px_rgba(217,119,6,0.14)] transition hover:bg-[var(--accent)]/15"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Next action</p>
          <p className="mt-2 text-sm font-semibold text-white">{mapData.primaryChip.label}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{mapData.primaryChip.detail}</p>
        </Link>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(21rem,0.95fr)]">
        <div className="space-y-6">
          <EngineeringWorkflowMap
            nodes={mapData.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
          <Dock links={mapData.dockLinks} />
        </div>

        <div className="space-y-6">
          <WorkflowNodeInspector inspector={selectedInspector} />
          <ActivityPanel items={mapData.activityItems} />
        </div>
      </div>

      {children}

      <DashboardIssueCenter
        issues={mapData.issues}
        onOpenIssue={(issue) => routeDashboardIssue(issue, setSelectedNodeId)}
        overlayState={overlayStates["issue-center"]}
        isTopmost
        onExpand={() =>
          setOverlayStates((current) =>
            openCanvasOverlay(current, "issue-center", {
              title: mapData.issues.length > 0 ? `Issues: ${mapData.issues.length}` : "Issues",
            }),
          )
        }
        onClose={() => setOverlayStates((current) => closeCanvasOverlay(current, "issue-center"))}
        onMinimize={() => setOverlayStates((current) => closeCanvasOverlay(current, "issue-center"))}
        onBringToFront={() => undefined}
        onMove={(position) =>
          setOverlayStates((current) => moveCanvasOverlay(current, "issue-center", position))
        }
      />
    </div>
  );
}
