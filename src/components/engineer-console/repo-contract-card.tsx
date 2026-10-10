"use client";

import Link from "next/link";
import React from "react";
import type {
  RepoFolderContract,
  RepoIndexFreshness,
  RepoMapLens,
  RepoRunOverlay,
} from "@/lib/engineer-console/dashboard/repo-control-plane";

const FRESHNESS_CLASS: Record<RepoIndexFreshness, string> = {
  current: "text-emerald-200/70",
  partial: "text-amber-200/70",
  stale: "text-amber-200/80",
  missing: "text-white/60",
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[12px] text-white/60">
      {children}
    </span>
  );
}

export function RepoContractCard({
  contract,
  freshness,
  freshnessLabel,
  runOverlay,
  lens,
  onLensChange,
}: {
  contract: RepoFolderContract | null;
  freshness: RepoIndexFreshness;
  freshnessLabel: string;
  runOverlay: RepoRunOverlay | null;
  lens: RepoMapLens;
  onLensChange: (lens: RepoMapLens) => void;
}) {
  const usesAvailable = (contract?.neighborNodeIds.length ?? 0) > 0;
  const items =
    contract && contract.routes.length > 0
      ? contract.routes.map((route) => `${route.method} ${route.routePath}`)
      : contract?.symbols.map((symbol) => `${symbol.kind} ${symbol.name}`) ?? [];

  return (
    <aside
      data-repo-contract-card="true"
      data-repo-freshness={freshness}
      data-repo-map-lens={lens}
      className="pointer-events-auto max-h-[min(40vh,20rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.4rem] border border-white/8 bg-black/45 p-3.5 backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-[12px] ${FRESHNESS_CLASS[freshness]}`}>{freshnessLabel}</p>
        {runOverlay?.label ? (
          runOverlay.href ? (
            <Link href={runOverlay.href} className="text-[12px] text-sky-200/80 hover:text-sky-100">
              {runOverlay.label}
            </Link>
          ) : (
            <p className="text-[12px] text-sky-200/80">{runOverlay.label}</p>
          )
        ) : null}
      </div>

      <p className="mt-2 truncate text-[14px] font-medium tracking-tight text-white">
        {contract?.label ?? "Repository"}
      </p>

      {contract ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip>{contract.fileCount} files</Chip>
          {contract.exportedCount > 0 ? <Chip>{contract.exportedCount} exports</Chip> : null}
          {contract.routeCount > 0 ? <Chip>{contract.routeCount} routes</Chip> : null}
          {contract.httpClientCount > 0 ? <Chip>{contract.httpClientCount} clients</Chip> : null}
          {contract.testRunner ? <Chip>{contract.testRunner}</Chip> : null}
          {contract.scripts.length > 0 ? <Chip>{contract.scripts.slice(0, 3).join(" · ")}</Chip> : null}
          {contract.linkBreakingCount > 0 ? <Chip>{contract.linkBreakingCount} breaking</Chip> : null}
          {contract.linkWarningCount > 0 ? <Chip>{contract.linkWarningCount} warnings</Chip> : null}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-white/60">Select a folder to see its contract.</p>
      )}

      {items.length > 0 ? (
        <ul className="mt-3 space-y-1" data-repo-contract-items="true">
          {items.slice(0, 5).map((item) => (
            <li key={item} className="truncate text-[13px] text-white/60">
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      {contract?.links[0] ? (
        <p className="mt-2 truncate text-[13px] text-white/60">{contract.links[0].summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-repo-uses-toggle="true"
          disabled={!usesAvailable}
          className={`rounded-full border px-2.5 py-1 text-[12px] ${
            lens === "uses"
              ? "border-white/20 bg-white/[0.08] text-white"
              : "border-white/10 text-white/55 hover:text-white"
          } disabled:cursor-not-allowed disabled:opacity-35`}
          onClick={() => onLensChange(lens === "uses" ? "inventory" : "uses")}
        >
          Who uses this
        </button>
        {contract?.changedCount ? (
          <span className="rounded-full border border-sky-200/15 px-2.5 py-1 text-[12px] text-sky-100/70">
            {contract.changedCount} in run
          </span>
        ) : null}
      </div>
    </aside>
  );
}
