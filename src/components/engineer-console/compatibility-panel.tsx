"use client";

import React from "react";
import Link from "next/link";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

import { useCallback, useEffect, useState } from "react";
import { OperatorHelp } from "./operator-help";
import { StatusBadge } from "./status-badge";

interface AnalysisRun {
  run: {
    id: string;
    status: string;
    repoCount: number;
    surfaceCount: number;
    linkCount: number;
    warningCount: number;
    breakingCount: number;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  };
}

interface ApiSurface {
  id: string;
  repoId: string;
  relativePath: string;
  surfaceType: string;
  method: string | null;
  routePath: string | null;
  name: string | null;
  confidence: string;
}

interface CrossRepoLink {
  id: string;
  sourceRepoId: string;
  targetRepoId: string;
  linkType: string;
  status: string;
  confidence: string;
  summary: string;
}

export function CompatibilityPanel() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [surfaces, setSurfaces] = useState<ApiSurface[]>([]);
  const [links, setLinks] = useState<CrossRepoLink[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [runsRes, surfacesRes, linksRes] = await Promise.all([
      engineerConsoleFetch("/api/engineer-console/compatibility/runs?limit=5"),
      engineerConsoleFetch("/api/engineer-console/compatibility/surfaces?limit=50"),
      engineerConsoleFetch(
        `/api/engineer-console/compatibility/links?limit=50${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    ]);

    if (!runsRes.ok || !surfacesRes.ok || !linksRes.ok) {
      throw new Error("Failed to load compatibility data");
    }

    const runsData = (await runsRes.json()) as { runs: AnalysisRun[] };
    const surfacesData = (await surfacesRes.json()) as { surfaces: ApiSurface[] };
    const linksData = (await linksRes.json()) as { links: CrossRepoLink[] };

    setRuns(runsData.runs);
    setSurfaces(surfacesData.surfaces);
    setLinks(linksData.links);
    setError(null);
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch("/api/engineer-console/compatibility/analyze", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const latest = runs[0]?.run;

  return (
    <div className="space-y-6">
      <Surface as="section">
        <SectionHeader
          title="Compatibility analysis"
          description="Compare registered repos for shared interfaces and cross-repo impact without changing code."
          meta={
            <OperatorHelp
              term="compatibility_analysis"
              label="What is compatibility analysis?"
            />
          }
          actions={
            <Button
              disabled={busy}
              onClick={() => void analyze()}
              size="sm"
              variant="secondary"
            >
              {busy ? "Analyzing…" : "Run compatibility analysis"}
            </Button>
          }
        />

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {loading && <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>}
        {!loading && (
          <p className="mt-4 text-sm text-[var(--muted)]">
            This compares registered repos for shared interfaces and possible cross-repo impact. It
            records findings only and does not change code.
          </p>
        )}

        {!loading && !latest && surfaces.length === 0 && links.length === 0 && (
          <div className="mt-4">
            <EmptyState
              compact
              title="Run code index, then compatibility analysis"
              description={
                <>
                  What is missing: no compatibility analysis results are recorded yet. Why it
                  matters: compatibility findings help governance review understand cross-repo
                  impact. What to click next: verify a repo, run file index, run code index, then
                  return here and run compatibility analysis.
                </>
              }
              action={
                <Link
                  href="/engineer/repos"
                  className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08]"
                >
                  Open registered repositories
                </Link>
              }
            />
          </div>
        )}

        {latest && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Latest run</dt>
              <dd className="mt-1">
                <StatusBadge status={latest.status} /> ·{" "}
                {new Date(latest.startedAt).toLocaleString()}
              </dd>
            </Surface>
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Surfaces / links</dt>
              <dd className="mt-1">
                {latest.surfaceCount} surfaces · {latest.linkCount} links
              </dd>
            </Surface>
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Warnings / breaking</dt>
              <dd className="mt-1">
                {latest.warningCount} warnings · {latest.breakingCount} breaking
              </dd>
            </Surface>
          </dl>
        )}
      </Surface>

      <Surface as="section">
        <SectionHeader
          title="Cross-repo links"
          actions={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1.5 text-xs text-white"
            >
              <option value="">All statuses</option>
              <option value="compatible">Compatible</option>
              <option value="warning">Warning</option>
              <option value="breaking">Breaking</option>
              <option value="unknown">Unknown</option>
            </select>
          }
        />
        {links.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              compact
              title="No cross-repo links yet"
              description="Run code index, then compatibility analysis."
            />
          </div>
        ) : (
          <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-xs">
            {links.map((link) => (
              <Surface key={link.id} as="li" padding="sm" variant="inset">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={link.status} />
                  <code>{link.linkType}</code>
                  <span className="text-[var(--muted)]">{link.confidence}</span>
                </div>
                <p className="mt-2">{link.summary}</p>
              </Surface>
            ))}
          </ul>
        )}
      </Surface>

      <Surface as="section">
        <SectionHeader title="API surfaces" />
        {surfaces.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              compact
              title="No API surfaces detected yet"
              description="Run file index, then code index, then compatibility analysis."
            />
          </div>
        ) : (
          <div className="mt-4 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[var(--muted)]">
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Method</th>
                  <th className="py-1 pr-2">Route / name</th>
                  <th className="py-1 pr-2">File</th>
                  <th className="py-1">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {surfaces.map((surface) => (
                  <tr key={surface.id} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-2">{surface.surfaceType}</td>
                    <td className="py-1 pr-2">{surface.method ?? "—"}</td>
                    <td className="py-1 pr-2 font-mono">{surface.routePath ?? surface.name ?? "—"}</td>
                    <td className="py-1 pr-2 font-mono">{surface.relativePath}</td>
                    <td className="py-1">{surface.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}
