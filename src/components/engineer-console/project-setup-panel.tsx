"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import type { EngineerProject } from "@/lib/engineer-console/project-orchestration/project-orchestration-types";

const FIELD_CLASS =
  "mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm";

export function ProjectSetupPanel({ project }: { project: EngineerProject }) {
  const router = useRouter();
  const [specTitle, setSpecTitle] = useState("");
  const [specContent, setSpecContent] = useState("");
  const [stableKey, setStableKey] = useState("");
  const [requirementTitle, setRequirementTitle] = useState("");
  const [requirementDescription, setRequirementDescription] = useState("");
  const [criterion, setCriterion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Project setup request failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project setup request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="text-lg font-semibold">Project setup</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Add the durable specification and initial requirement records Vera will orchestrate.
      </p>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="font-medium text-white">Attach specification version</h3>
          <label className="mt-3 block text-sm">
            Title
            <input value={specTitle} onChange={(event) => setSpecTitle(event.target.value)} className={FIELD_CLASS} />
          </label>
          <label className="mt-3 block text-sm">
            Specification content
            <textarea
              value={specContent}
              onChange={(event) => setSpecContent(event.target.value)}
              rows={6}
              className={FIELD_CLASS}
            />
          </label>
          <button
            disabled={busy || !specTitle.trim() || !specContent.trim()}
            onClick={() =>
              submit(`/api/engineer-console/projects/${project.id}/specifications`, {
                title: specTitle,
                content: specContent,
              })
            }
            className="mt-3 rounded bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Add specification
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="font-medium text-white">Add requirement</h3>
          <label className="mt-3 block text-sm">
            Stable key
            <input value={stableKey} onChange={(event) => setStableKey(event.target.value)} className={FIELD_CLASS} />
          </label>
          <label className="mt-3 block text-sm">
            Title
            <input
              value={requirementTitle}
              onChange={(event) => setRequirementTitle(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="mt-3 block text-sm">
            Description
            <textarea
              value={requirementDescription}
              onChange={(event) => setRequirementDescription(event.target.value)}
              rows={3}
              className={FIELD_CLASS}
            />
          </label>
          <label className="mt-3 block text-sm">
            Acceptance criterion
            <textarea
              value={criterion}
              onChange={(event) => setCriterion(event.target.value)}
              rows={3}
              className={FIELD_CLASS}
            />
          </label>
          <button
            disabled={busy || !stableKey.trim() || !requirementTitle.trim() || !criterion.trim()}
            onClick={() =>
              submit(`/api/engineer-console/projects/${project.id}/requirements`, {
                stableKey,
                title: requirementTitle,
                description: requirementDescription,
                acceptanceCriteria: [
                  {
                    stableKey: `${stableKey}.AC1`,
                    description: criterion,
                    verificationType: "manual_review",
                    evidenceRequired: true,
                  },
                ],
              })
            }
            className="mt-3 rounded bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Add requirement
          </button>
        </div>
      </div>
    </section>
  );
}
