"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

const FIELD_CLASS =
  "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm";

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetRepoPath, setTargetRepoPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch("/api/engineer-console/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, targetRepoPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create project");
      router.push(`/engineer/projects/${data.project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="text-lg font-semibold">Create governed project</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Define the durable project boundary Vera will orchestrate against.
      </p>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <label className="mt-4 block text-sm">
        Project name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={FIELD_CLASS} />
      </label>
      <label className="mt-3 block text-sm">
        Objective and constraints
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={FIELD_CLASS}
        />
      </label>
      <label className="mt-3 block text-sm">
        Target repository path for generated tasks
        <input
          value={targetRepoPath}
          onChange={(e) => setTargetRepoPath(e.target.value)}
          placeholder="/path/to/repo"
          className={`${FIELD_CLASS} font-mono text-xs`}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create project"}
      </button>
    </form>
  );
}
