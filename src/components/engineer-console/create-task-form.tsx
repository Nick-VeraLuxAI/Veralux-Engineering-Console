"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicRegisteredRepo } from "./registered-repos-panel";

export function CreateTaskForm({ onClose }: { onClose: () => void }) {
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
