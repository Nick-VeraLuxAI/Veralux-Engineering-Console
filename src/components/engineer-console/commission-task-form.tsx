"use client";

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { submitCommissionedTask } from "@/lib/engineer-console-client/commission-task";
import { publicCommissionTaskError } from "@/lib/engineer-console/dashboard/commission-task-intent";
import {
  START_RUN_CHECKBOX_LABEL,
  defaultStartRunAfterCreate,
  validateDraftTaskJob,
} from "@/lib/engineer-console/dashboard/draft-job-schema";

export type CommissionTaskDraft = {
  title: string;
  objective: string;
  success: string;
  constraints: string;
};

export type CommissionTaskFormHandle = {
  getDraft: () => CommissionTaskDraft;
};

export const CommissionTaskForm = forwardRef<
  CommissionTaskFormHandle,
  {
    initialTitle?: string;
    initialObjective?: string;
    initialSuccess?: string;
    initialConstraints?: string;
    initialStartRun?: boolean;
    workingRepo?: { id: string; name: string } | null;
    variant?: "card" | "sheet";
    compact?: boolean;
    showStartRun?: boolean;
    showSubmit?: boolean;
    onCommissioned?: (input: { taskId: string; runId?: string; redirect: string }) => void;
  }
>(function CommissionTaskForm(
  {
    initialTitle = "",
    initialObjective = "",
    initialSuccess = "",
    initialConstraints = "",
    initialStartRun,
    workingRepo = null,
    variant = "card",
    compact = false,
    showStartRun,
    showSubmit = true,
    onCommissioned,
  },
  ref,
) {
  const [title, setTitle] = useState(initialTitle);
  const [objective, setObjective] = useState(initialObjective);
  const [success, setSuccess] = useState(initialSuccess);
  const [constraints, setConstraints] = useState(initialConstraints);
  const [startRun, setStartRun] = useState(initialStartRun ?? defaultStartRunAfterCreate());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const repoId = workingRepo?.id ?? "";
  const repoName = workingRepo?.name ?? null;
  const startRunVisible = showStartRun ?? !compact;
  const fieldClass =
    variant === "sheet"
      ? "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      : "mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";

  const draftValidation = validateDraftTaskJob({
    title,
    objective,
    repo: repoName,
    repoId,
    startRunAfterCreate: startRunVisible ? startRun : false,
  });
  const createDisabled = busy || !draftValidation.valid;

  useImperativeHandle(
    ref,
    () => ({
      getDraft: () => ({ title, objective, success, constraints }),
    }),
    [title, objective, success, constraints],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!showSubmit || createDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitCommissionedTask({
        title,
        objective,
        success,
        constraints,
        registeredRepoId: repoId,
        startRun: startRunVisible ? startRun : false,
      });
      if (result.startError) {
        throw new Error(result.startError);
      }
      if (onCommissioned) {
        onCommissioned(result);
        return;
      }
      window.location.assign(result.redirect);
    } catch (err) {
      setError(publicCommissionTaskError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-commission-task-form="true"
      onSubmit={handleSubmit}
      className={variant === "sheet" ? "" : "space-y-3"}
    >
      {variant === "sheet" ? (
        <h2 className="mb-3 font-semibold">Commission a task</h2>
      ) : compact ? null : (
        <p className="text-[13px] font-medium text-white">Commission a task</p>
      )}
      {error ? (
        <p className={`text-sm ${variant === "sheet" ? "mb-3 text-red-400" : "text-rose-300/80"}`}>{error}</p>
      ) : null}
      <p className={variant === "sheet" ? "mb-3 text-[13px] text-[var(--muted)]" : "text-[13px] text-white/60"}>
        {repoName
          ? `Working repo: ${repoName}`
          : "Select a working repo first. This card does not start a run unless you check that box."}
      </p>
      {!draftValidation.valid ? (
        <p
          data-commission-task-invalid="true"
          className={variant === "sheet" ? "mb-3 text-[13px] text-amber-300" : "text-[13px] text-amber-200/90"}
        >
          Invalid draft: {draftValidation.reasons.join("; ")}
        </p>
      ) : null}
      <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
        Title
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={fieldClass}
          placeholder="Add a login gate"
          autoComplete="off"
        />
      </label>
      <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
        Objective
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          className={fieldClass}
          rows={3}
          placeholder="What should exist when we are done"
        />
      </label>
      <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
        Success (optional)
        <textarea
          value={success}
          onChange={(event) => setSuccess(event.target.value)}
          className={fieldClass}
          rows={2}
          placeholder="Optional. What proves this job worked?"
        />
      </label>
      {compact ? null : (
        <label className={`block text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
          Constraints (optional)
          <textarea
            value={constraints}
            onChange={(event) => setConstraints(event.target.value)}
            className={fieldClass}
            rows={2}
            placeholder="What not to touch"
          />
        </label>
      )}
      {startRunVisible ? (
        <label className={`flex items-center gap-2 text-sm ${variant === "sheet" ? "mb-3" : ""}`}>
          <input
            type="checkbox"
            data-commission-task-start-run="true"
            checked={startRun}
            onChange={(event) => setStartRun(event.target.checked)}
          />
          {START_RUN_CHECKBOX_LABEL}
        </label>
      ) : null}
      {showSubmit ? (
        <>
          <p className={variant === "sheet" ? "mb-3 text-[13px] text-[var(--muted)]" : "text-[13px] text-white/60"}>
            Creates a draft task on the working repo. The start-run box is a human start through the existing run route.
          </p>
          <button
            type="submit"
            data-commission-task-confirm="true"
            data-motion-press="true"
            disabled={createDisabled}
            className={
              variant === "sheet"
                ? "inline-flex rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
                : "inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[12px] text-white disabled:opacity-40"
            }
          >
            {busy
              ? startRun
                ? "Starting…"
                : "Creating…"
              : compact
                ? "Confirm"
                : startRun
                  ? "Create task and start run"
                  : "Create task"}
          </button>
        </>
      ) : null}
    </form>
  );
});
