"use client";

import React, { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { saveCanvasWorkingRepoId } from "@/components/engineer-console/canvas-top-bar";
import {
  publicStartRepoError,
  sanitizeRepoFolderName,
} from "@/lib/engineer-console/dashboard/start-repo-intent";

export function StartRepoForm({
  initialName = "",
  initialDescription = "",
  variant = "card",
  embedded = false,
  onStarted,
}: {
  initialName?: string;
  initialDescription?: string;
  variant?: "card" | "sheet";
  embedded?: boolean;
  onStarted?: (input: { id: string; name: string; redirect: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folder = sanitizeRepoFolderName(name);
  const fieldClass =
    variant === "sheet"
      ? "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      : "mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await engineerConsoleFetch("/api/engineer-console/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          create: true,
          name: folder,
          description: description.trim() || undefined,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        repo?: { id: string; name: string };
        redirect?: string;
      };
      if (!response.ok || !data.repo) {
        throw new Error(data.error ?? "Could not start the repository");
      }
      const redirect = data.redirect ?? `/engineer?focus=repository&repo=${encodeURIComponent(data.repo.id)}`;
      saveCanvasWorkingRepoId(data.repo.id);
      if (onStarted) {
        onStarted({ id: data.repo.id, name: data.repo.name, redirect });
        return;
      }
      window.location.assign(redirect);
    } catch (err) {
      setError(publicStartRepoError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-start-repo-form="true"
      onSubmit={handleSubmit}
      className={variant === "sheet" ? "" : "space-y-3"}
    >
      {variant === "sheet" ? (
        <h2 className="mb-3 font-semibold">Start a new repository</h2>
      ) : embedded ? null : (
        <p className="text-[13px] font-medium text-white">Start a new repo</p>
      )}
      {error ? (
        <p className={`text-sm ${variant === "sheet" ? "mb-3 text-red-400" : "text-rose-300/80"}`}>{error}</p>
      ) : null}
      <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
        Name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
          placeholder="orchard"
          autoComplete="off"
        />
      </label>
      <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
        What it is for (optional)
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClass}
          placeholder="Internal portal for crews"
        />
      </label>
      <p className={variant === "sheet" ? "mb-3 text-[13px] text-[var(--muted)]" : "text-[13px] text-white/60"}>
        Creates a local git repo under your approved root and maps it. This does not start a run.
      </p>
      <button
        type="submit"
        data-start-repo-confirm="true"
        data-motion-press="true"
        disabled={busy || !folder}
        className={
          variant === "sheet"
            ? "inline-flex rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            : "inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[13px] text-white disabled:opacity-40"
        }
      >
        {busy ? "Starting…" : "Start repo"}
      </button>
    </form>
  );
}
