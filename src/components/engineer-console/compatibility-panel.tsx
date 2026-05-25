"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
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
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Compatibility analysis</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
          >
            {busy ? "Analyzing…" : "Run compatibility analysis"}
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}

        {latest && (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--muted)]">Latest run</dt>
              <dd>
                <StatusBadge status={latest.status} /> ·{" "}
                {new Date(latest.startedAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Surfaces / links</dt>
              <dd>
                {latest.surfaceCount} surfaces · {latest.linkCount} links
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Warnings / breaking</dt>
              <dd>
                {latest.warningCount} warnings · {latest.breakingCount} breaking
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Cross-repo links</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
          >
            <option value="">All statuses</option>
            <option value="compatible">Compatible</option>
            <option value="warning">Warning</option>
            <option value="breaking">Breaking</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No cross-repo links yet.</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-auto text-xs">
            {links.map((link) => (
              <li key={link.id} className="rounded border border-[var(--border)] p-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={link.status} />
                  <code>{link.linkType}</code>
                  <span className="text-[var(--muted)]">{link.confidence}</span>
                </div>
                <p>{link.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 font-semibold">API surfaces</h2>
        {surfaces.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No API surfaces detected yet.</p>
        ) : (
          <div className="max-h-64 overflow-auto">
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
      </section>
    </div>
  );
}
