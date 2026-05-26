"use client";

import React from "react";
import Link from "next/link";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StagingTaskPreset } from "@/lib/engineer-console/setup/setup-ux";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import type { PublicRegisteredRepo } from "./registered-repos-panel";

const FIELD_CLASS_NAME =
  "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

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
      <Surface
        as="form"
        onSubmit={handleSubmit}
        className="w-full max-w-lg"
        padding="lg"
        variant="elevated"
      >
        <h2 className="mb-4 text-lg font-semibold">Create engineering task</h2>
        {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
        <Surface className="mb-4 text-sm text-[var(--muted)]" padding="sm" variant="inset">
          <p className="font-medium text-white">Safest default</p>
          <p className="mt-1">
            Prefer a verified registered repository. Manual path fallback remains available, but it
            should still point to an approved repo root.
          </p>
        </Surface>
        {registeredRepoCount === 0 ? (
          <Surface className="mb-4 text-sm text-amber-200" padding="sm" variant="warning">
            <p className="font-medium">Register and verify a repo first.</p>
            <p className="mt-1">
              What is missing: there are no registered repos yet. Why it matters: verified repos are
              the safest way to create tasks. What to click next: open{" "}
              <Link href="/engineer/repos" className="underline underline-offset-2">
                Registered repositories
              </Link>
              .
            </p>
          </Surface>
        ) : null}
        {showStagingPreset ? (
          <Surface className="mb-4 text-sm" padding="sm" variant="glass">
            <p className="font-medium text-white">Staging helper preset</p>
            <p className="mt-1 text-[var(--muted)]">
              Use a small and safe README smoke task for staging verification.
            </p>
            <Button
              onClick={applyStagingPreset}
              className="mt-3"
              size="sm"
              variant="secondary"
            >
              Use staging README preset
            </Button>
          </Surface>
        ) : null}
        <label className="mb-3 block text-sm">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={FIELD_CLASS_NAME}
          />
        </label>
        <label className="mb-3 block text-sm">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={FIELD_CLASS_NAME}
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
            className={FIELD_CLASS_NAME}
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
            className={`${FIELD_CLASS_NAME} font-mono text-xs disabled:opacity-50`}
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
            className={FIELD_CLASS_NAME}
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button
            onClick={onClose}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            variant="primary"
          >
            {submitting ? "Creating…" : "Create task"}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
