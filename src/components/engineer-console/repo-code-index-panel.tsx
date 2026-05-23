"use client";

import { useCallback, useEffect, useState } from "react";

interface PublicSymbol {
  relativePath: string;
  name: string;
  kind: string;
  lineStart: number;
  exported: boolean;
}

interface PublicChunk {
  relativePath: string;
  startLine: number;
  endLine: number;
  contentPreview: string;
  contentHashPrefix: string;
}

interface CodeIndexRunSummary {
  symbolCount: number;
  chunkCount: number;
  skippedCount: number;
  completedAt: string | null;
}

export function RepoCodeIndexPanel({
  repoId,
  verificationStatus,
  fileCount,
}: {
  repoId: string;
  verificationStatus: string;
  fileCount: number;
}) {
  const [symbolCount, setSymbolCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [symbols, setSymbols] = useState<PublicSymbol[]>([]);
  const [chunks, setChunks] = useState<PublicChunk[]>([]);
  const [query, setQuery] = useState("");
  const [lastRun, setLastRun] = useState<CodeIndexRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSearch = useCallback(async () => {
    const q = query.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=30` : "?limit=30";
    try {
      const [symRes, chunkRes] = await Promise.all([
        fetch(`/api/engineer-console/repos/${repoId}/symbols${q}`),
        fetch(`/api/engineer-console/repos/${repoId}/chunks${q}`),
      ]);
      if (symRes.ok) {
        const data = (await symRes.json()) as { symbols: PublicSymbol[]; count: number };
        setSymbols(data.symbols);
        if (!query.trim()) setSymbolCount(data.count);
      }
      if (chunkRes.ok) {
        const data = (await chunkRes.json()) as { chunks: PublicChunk[]; count: number };
        setChunks(data.chunks);
        if (!query.trim()) setChunkCount(data.count);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repoId, query]);

  useEffect(() => {
    if (symbolCount > 0 || chunkCount > 0) {
      void loadSearch();
    }
  }, [symbolCount, chunkCount, loadSearch]);

  async function runCodeIndex() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/engineer-console/repos/${repoId}/code-index`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Code index failed");
      const run = data.indexRun as CodeIndexRunSummary;
      setLastRun(run);
      setSymbolCount(run.symbolCount);
      setChunkCount(run.chunkCount);
      await loadSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canIndex = verificationStatus === "ok" && fileCount > 0;

  return (
    <div className="mt-3 rounded border border-[var(--border)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">Code index (symbols + chunks)</p>
        <button
          type="button"
          disabled={!canIndex || busy}
          onClick={() => void runCodeIndex()}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
        >
          {busy ? "Indexing code…" : "Index code"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Symbols: {symbolCount} · Chunks: {chunkCount}
        {lastRun?.completedAt ? ` · ${new Date(lastRun.completedAt).toLocaleString()}` : ""}
      </p>
      {fileCount === 0 && (
        <p className="mt-1 text-xs text-amber-300">Run file index before code index.</p>
      )}
      {verificationStatus !== "ok" && (
        <p className="mt-1 text-xs text-amber-300">Verify repository before code index.</p>
      )}
      {lastRun && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Last run: {lastRun.symbolCount} symbols, {lastRun.chunkCount} chunks, skipped{" "}
          {lastRun.skippedCount}
        </p>
      )}
      {(symbolCount > 0 || chunkCount > 0) && (
        <label className="mt-2 block text-xs">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadSearch();
            }}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-xs"
            placeholder="symbol or path"
          />
        </label>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {symbols.length > 0 && (
        <div className="mt-2 max-h-32 overflow-auto">
          <p className="mb-1 text-xs font-medium text-[var(--muted)]">Symbols</p>
          <ul className="space-y-1 font-mono text-xs">
            {symbols.map((s) => (
              <li key={`${s.relativePath}:${s.lineStart}:${s.name}`}>
                {s.relativePath}:{s.lineStart} {s.kind} {s.name}
                {s.exported ? " · exp" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {chunks.length > 0 && (
        <div className="mt-2 max-h-40 overflow-auto">
          <p className="mb-1 text-xs font-medium text-[var(--muted)]">Chunk previews</p>
          <ul className="space-y-2 text-xs">
            {chunks.map((c) => (
              <li key={`${c.relativePath}:${c.startLine}`} className="rounded bg-[var(--background)] p-2">
                <p className="font-mono text-[var(--muted)]">
                  {c.relativePath}:{c.startLine}-{c.endLine} · {c.contentHashPrefix}
                </p>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{c.contentPreview}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
