"use client";

import React from "react";
import Link from "next/link";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StagingTaskPreset } from "@/lib/engineer-console/setup/setup-ux";
import type { PublicRegisteredRepo } from "./registered-repos-panel";

export function CreateTaskForm({
  onClose,
  showStagingPreset,
  stagingTaskPreset,
  registeredRepoCount,
}: {
  onClose: () => void;
  showStagingPreset: boolean;
  stagingTaskPreset: StagingTaskPreset;
  registeredRepoCount: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [registeredRepoId, setRegisteredRepoId] = useState("");
  const [targetRepoPath, setTargetRepoPath] = useState("");
  const [repos, setRepos] = useState<PublicRegisteredRepo[]>([]);
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void engineerConsoleFetch("/api/engineer-console/repos")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.repos) setRepos(data.repos as PublicRegisteredRepo[]);
      });
  }, []);

  function applyStagingPreset() {
    setTitle(stagingTaskPreset.title);
    setDescription(stagingTaskPreset.description);
    setPriority(stagingTaskPreset.priority);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string> = { title, description, priority };
      if (registeredRepoId) {
        payload.registeredRepoId = registeredRepoId;
      } else {
        payload.targetRepoPath = targetRepoPath;
      }

      const res = await engineerConsoleFetch("/api/engineer-console/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create task");
      }
      router.push(`/engineer/tasks/${data.task.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Create engineering task</h2>
        {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
        <div className="mb-4 rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
          <p className="font-medium text-white">Safest default</p>
          <p className="mt-1">
            Prefer a verified registered repository. Manual path fallback remains available, but it
            should still point to an approved repo root.
          </p>
        </div>
        {registeredRepoCount === 0 ? (
          <div className="mb-4 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-sm text-amber-200">
            <p className="font-medium">Register and verify a repo first.</p>
            <p className="mt-1">
              What is missing: there are no registered repos yet. Why it matters: verified repos are
              the safest way to create tasks. What to click next: open{" "}
              <Link href="/engineer/repos" className="underline underline-offset-2">
                Registered repositories
              </Link>
              .
            </p>
          </div>
        ) : null}
        {showStagingPreset ? (
          <div className="mb-4 rounded border border-blue-900/50 bg-blue-950/20 p-3 text-sm">
            <p className="font-medium text-white">Staging helper preset</p>
            <p className="mt-1 text-[var(--muted)]">
              Use a small and safe README smoke task for staging verification.
            </p>
            <button
              type="button"
              onClick={applyStagingPreset}
              className="mt-3 rounded border border-[var(--border)] px-3 py-2 text-sm font-medium"
            >
              Use staging README preset
            </button>
          </div>
        ) : null}
        <label className="mb-3 block text-sm">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          />
        </label>
        <label className="mb-3 block text-sm">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          />
        </label>
        <label className="mb-3 block text-sm">
          Registered repository (recommended)
          <select
            value={registeredRepoId}
            onChange={(e) => {
              setRegisteredRepoId(e.target.value);
              if (e.target.value) setTargetRepoPath("");
            }}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            <option value="">— Manual path fallback —</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name} ({repo.verificationStatus})
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3 block text-sm">
          Target repo path — manual fallback
          <input
            required={!registeredRepoId}
            disabled={Boolean(registeredRepoId)}
            value={targetRepoPath}
            onChange={(e) => setTargetRepoPath(e.target.value)}
            placeholder="/path/to/your/repo"
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs disabled:opacity-50"
          />
        </label>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Manual fallback is still supported, but the path must be inside approved repo roots when
          they are configured.
        </p>
        <label className="mb-4 block text-sm">
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--border)] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create task"}
          </button>
        </div>
      </form>
    </div>
  );
}
