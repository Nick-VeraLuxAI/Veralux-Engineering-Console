"use client";

import Link from "next/link";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  emptyRepoControlPlane,
  type RepoFolderContract,
  type RepoMapLens,
} from "@/lib/engineer-console/dashboard/repo-control-plane";
import type { MappedCodebase } from "@/lib/engineer-console/repo-intelligence/github/codebase-map";
import {
  fitRepoMapView,
  layoutRepoVisualMap,
  REPO_MAP_NODE_SIZE,
  type RepoMapNodeId,
} from "@/lib/engineer-console/dashboard/repo-visual-map";
import { RepoContractCard } from "./repo-contract-card";
import { StartRepoForm } from "./start-repo-form";

const KIND_CLASS: Record<string, string> = {
  repo: "border-white/20 bg-white/[0.07]",
  source: "border-sky-200/25 bg-sky-500/8",
  test: "border-emerald-200/25 bg-emerald-500/8",
  docs: "border-amber-200/20 bg-amber-500/8",
  config: "border-white/12 bg-white/[0.04]",
  other: "border-white/10 bg-white/[0.03]",
};

export function RepoMapCanvas({
  repo,
  onSelectedContract,
}: {
  repo: MappedCodebase | null;
  onSelectedContract?: (contract: RepoFolderContract | null) => void;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ width: 960, height: 640 });
  const [selectedId, setSelectedId] = useState<RepoMapNodeId>("repo");
  const [lens, setLens] = useState<RepoMapLens>("inventory");
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const layout = useMemo(() => (repo ? layoutRepoVisualMap(repo.visual) : null), [repo]);
  const control = repo?.control ?? emptyRepoControlPlane();
  const selectedContract = control.contracts[selectedId] ?? control.contracts.repo ?? null;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      setViewport({
        width: Math.max(container.clientWidth, 1),
        height: Math.max(container.clientHeight, 1),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!layout) return;
    setView(fitRepoMapView(layout, viewport));
  }, [layout, viewport]);

  useEffect(() => {
    setSelectedId("repo");
    setLens("inventory");
  }, [repo?.id]);

  useEffect(() => {
    onSelectedContract?.(selectedContract);
  }, [onSelectedContract, selectedContract]);

  const neighborIds = useMemo(
    () => new Set<RepoMapNodeId>(selectedContract?.neighborNodeIds ?? []),
    [selectedContract],
  );
  const changedIds = useMemo(
    () => new Set<RepoMapNodeId>(control.runOverlay?.changedNodeIds ?? []),
    [control.runOverlay],
  );
  const connectedIds = useMemo(() => {
    if (!layout) return new Set<RepoMapNodeId>(["repo"]);
    const next = new Set<RepoMapNodeId>([selectedId]);
    layout.edges.forEach((edge) => {
      if (edge.source === selectedId || edge.target === selectedId) {
        next.add(edge.source);
        next.add(edge.target);
      }
    });
    if (lens === "uses") {
      neighborIds.forEach((id) => next.add(id));
    }
    return next;
  }, [layout, lens, neighborIds, selectedId]);

  if (!repo) {
    return (
      <section
        data-repo-map-canvas="true"
        data-repo-map-empty="true"
        className="relative flex h-full items-center justify-center px-6"
        aria-label="Repository map"
      >
        <div className="max-w-sm text-left">
          <p className="text-center text-[13px] text-white/70">No repository is mapped yet.</p>
          <p className="mt-2 text-center text-[13px] text-white/60">
            Start a new local git repo here, or register an existing path.
          </p>
          <div className="mt-4 rounded-[1.4rem] border border-white/8 bg-black/40 p-4">
            <StartRepoForm />
          </div>
          <p className="mt-3 text-center">
            <Link
              href="/engineer/repos"
              className="text-[12px] text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              Register an existing path
            </Link>
          </p>
        </div>
        <div className="absolute bottom-20 left-4">
          <RepoContractCard
            contract={null}
            freshness="missing"
            freshnessLabel="No file index"
            runOverlay={null}
            lens="inventory"
            onLensChange={() => undefined}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      data-repo-map-canvas="true"
      data-repo-map-source={repo.visual.source}
      data-repo-map-id={repo.id}
      data-repo-map-lens={lens}
      className="relative h-full min-h-0 overflow-hidden"
      aria-label={`${repo.name} repository map`}
      onWheel={(event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.08 : 0.92;
        setView((current) => ({
          ...current,
          zoom: Math.min(1.6, Math.max(0.28, current.zoom * factor)),
        }));
      }}
    >
      <div className="absolute inset-0 bg-[#02050a]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_34%)]" />

      {layout ? (
        <div
          data-repo-map-world="true"
          data-repo-map-zoom={view.zoom.toFixed(2)}
          className="absolute left-0 top-0"
          style={{
            width: layout.size.width,
            height: layout.size.height,
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            className="absolute inset-0 overflow-visible"
            width={layout.size.width}
            height={layout.size.height}
            viewBox={`0 0 ${layout.size.width} ${layout.size.height}`}
          >
            {layout.edges.map((edge) => {
              const source = layout.nodes.find((node) => node.id === edge.source);
              const target = layout.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              const x1 = source.x + REPO_MAP_NODE_SIZE.width;
              const y1 = source.y + REPO_MAP_NODE_SIZE.height / 2;
              const x2 = target.x;
              const y2 = target.y + REPO_MAP_NODE_SIZE.height / 2;
              const mid = x1 + (x2 - x1) / 2;
              const active = connectedIds.has(edge.source) && connectedIds.has(edge.target);
              return (
                <path
                  key={edge.id}
                  data-repo-map-edge={edge.id}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"}
                  strokeWidth="1.4"
                />
              );
            })}
            {lens === "uses"
              ? [...neighborIds].map((neighborId) => {
                  const source = layout.nodes.find((node) => node.id === selectedId);
                  const target = layout.nodes.find((node) => node.id === neighborId);
                  if (!source || !target) return null;
                  const x1 = source.x + REPO_MAP_NODE_SIZE.width / 2;
                  const y1 = source.y + REPO_MAP_NODE_SIZE.height / 2;
                  const x2 = target.x + REPO_MAP_NODE_SIZE.width / 2;
                  const y2 = target.y + REPO_MAP_NODE_SIZE.height / 2;
                  return (
                    <path
                      key={`uses-${neighborId}`}
                      data-repo-map-uses-edge={neighborId}
                      d={`M ${x1} ${y1} L ${x2} ${y2}`}
                      fill="none"
                      stroke="rgba(186, 230, 253, 0.45)"
                      strokeDasharray="5 5"
                      strokeWidth="1.4"
                    />
                  );
                })
              : null}
          </svg>
          {layout.nodes.map((node) => {
            const selected = node.id === selectedId;
            const connected = connectedIds.has(node.id);
            const changed = changedIds.has(node.id);
            const neighbor = neighborIds.has(node.id);
            return (
              <button
                key={node.id}
                type="button"
                data-repo-map-node={node.id}
                data-repo-map-kind={node.kind}
                data-node-selected={selected ? "true" : "false"}
                data-repo-map-changed={changed ? "true" : "false"}
                data-repo-map-neighbor={neighbor ? "true" : "false"}
                onClick={() => {
                  setSelectedId(node.id);
                  setLens("inventory");
                }}
                style={{
                  left: node.x,
                  top: node.y,
                  width: REPO_MAP_NODE_SIZE.width,
                  height: REPO_MAP_NODE_SIZE.height,
                }}
                className={`absolute rounded-[1.25rem] border px-3.5 text-left backdrop-blur-xl transition ${
                  KIND_CLASS[node.kind]
                } ${selected ? "scale-[1.03] border-white/30 bg-white/[0.08]" : ""} ${
                  changed ? "shadow-[0_0_0_1px_rgba(125,211,252,0.35)]" : ""
                } ${neighbor && lens === "uses" ? "border-sky-100/30" : ""} ${
                  connected || selected || changed ? "opacity-100" : "opacity-45"
                }`}
              >
                <p className="truncate text-[14px] font-medium tracking-tight text-white">{node.label}</p>
                <p className="mt-0.5 truncate text-[13px] text-white/60">{node.detail}</p>
              </button>
            );
          })}
        </div>
      ) : null}

      {repo.visual.folders.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-10 px-6 text-center">
          <p className="text-[13px] text-white/60">
            Run file index to map source, tests, and docs around this repo.
          </p>
        </div>
      ) : null}

      <div className="absolute bottom-20 left-4 z-20">
        <RepoContractCard
          contract={selectedContract}
          freshness={control.freshness}
          freshnessLabel={control.freshnessLabel}
          runOverlay={control.runOverlay}
          lens={lens}
          onLensChange={setLens}
        />
      </div>

      <div className="absolute bottom-20 right-4 z-20 flex gap-2">
        <button
          type="button"
          data-repo-map-fit="true"
          className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[12px] text-white/60 backdrop-blur-xl hover:text-white"
          onClick={() => layout && setView(fitRepoMapView(layout, viewport))}
        >
          Fit
        </button>
        <Link
          href="/engineer/repos"
          className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[12px] text-white/60 backdrop-blur-xl hover:text-white"
        >
          Repo details
        </Link>
      </div>
    </section>
  );
}
