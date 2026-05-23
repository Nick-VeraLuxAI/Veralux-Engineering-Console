"use client";

import { useCallback, useEffect, useState } from "react";

interface PublicIndexedFile {
  relativePath: string;
  language: string | null;
  sizeBytes: number;
  contentHashPrefix: string;
  indexedAt: string;
}

interface IndexRunSummary {
  id: string;
  status: string;
  indexedCount: number;
  skippedCount: number;
  scannedCount: number;
  skippedSummary: Record<string, number>;
  completedAt: string | null;
}

export function RepoFileIndexPanel({
  repoId,
  verificationStatus,
  initialFileCount,
  initialIndexedAt,
}: {
  repoId: string;
  verificationStatus: string;
  initialFileCount: number;
  initialIndexedAt: string | null;
}) {
  const [fileCount, setFileCount] = useState(initialFileCount);
  const [indexedAt, setIndexedAt] = useState(initialIndexedAt);
  const [files, setFiles] = useState<PublicIndexedFile[]>([]);
  const [lastRun, setLastRun] = useState<IndexRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(`/api/engineer-console/repos/${repoId}/files?limit=100`);
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { files: PublicIndexedFile[] };
      setFiles(data.files);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFiles(false);
    }
  }, [repoId]);

  useEffect(() => {
    if (fileCount > 0) {
      void loadFiles();
    }
  }, [fileCount, loadFiles]);

  async function runIndex() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/engineer-console/repos/${repoId}/index`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Index failed");
      const run = data.indexRun as IndexRunSummary;
      setLastRun(run);
      setFileCount(run.indexedCount);
      setIndexedAt(run.completedAt);
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canIndex = verificationStatus === "ok";

  return (
    <div className="mt-3 rounded border border-[var(--border)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">File index</p>
        <button
          type="button"
          disabled={!canIndex || busy}
          onClick={() => void runIndex()}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
        >
          {busy ? "Indexing…" : "Index files"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Indexed: {fileCount} file(s)
        {indexedAt ? ` · ${new Date(indexedAt).toLocaleString()}` : ""}
      </p>
      {!canIndex && (
        <p className="mt-1 text-xs text-amber-300">Verify repository before indexing.</p>
      )}
      {lastRun && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Last run: scanned {lastRun.scannedCount}, indexed {lastRun.indexedCount}, skipped{" "}
          {lastRun.skippedCount}
          {Object.keys(lastRun.skippedSummary).length > 0
            ? ` (${Object.entries(lastRun.skippedSummary)
                .map(([k, v]) => `${k}:${v}`)
                .join(", ")})`
            : ""}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {loadingFiles && <p className="mt-2 text-xs text-[var(--muted)]">Loading file list…</p>}
      {files.length > 0 && (
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="py-1 pr-2">Path</th>
                <th className="py-1 pr-2">Lang</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1">Hash</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.relativePath} className="border-t border-[var(--border)] font-mono">
                  <td className="py-1 pr-2 break-all">{f.relativePath}</td>
                  <td className="py-1 pr-2">{f.language ?? "—"}</td>
                  <td className="py-1 pr-2">{f.sizeBytes}</td>
                  <td className="py-1">{f.contentHashPrefix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
