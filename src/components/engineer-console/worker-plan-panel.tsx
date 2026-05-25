"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkerPlanExecutionResult,
  WorkerPlanValidationResult,
} from "@/lib/engineer-console/worker-plan/worker-plan-types";
import {
  buildGuidedWorkerPlan,
  buildReadmeSmokeWorkerPlan,
  inspectWorkerPlanJsonInput,
  type GuidedWorkerPlanOperationInput,
  type WorkerPlanPreviewItem,
} from "@/lib/engineer-console/worker-plan/worker-plan-ux";
import type { WorkerPlanReportSummary } from "@/lib/engineer-console/types";
import { OperatorHelp } from "./operator-help";

type PlanSource = "guided" | "advanced";

interface GuidedWorkerPlanState {
  summary: string;
  operations: GuidedWorkerPlanOperationInput[];
}

const EMPTY_OPERATION: GuidedWorkerPlanOperationInput = {
  type: "create_file",
  path: "",
  reason: "",
  content: "",
};

function builderStateFromPlanJson(
  jsonText: string,
  currentRunId: string,
  taskTitle: string,
  taskDescription: string,
): GuidedWorkerPlanState | null {
  const inspection = inspectWorkerPlanJsonInput({
    text: jsonText,
    currentRunId,
    taskTitle,
    taskDescription,
  });
  if (!inspection.plan) return null;
  return {
    summary: inspection.plan.summary,
    operations:
      inspection.plan.operations.length > 0 ? inspection.plan.operations : [{ ...EMPTY_OPERATION }],
  };
}

function builderStateFromReadmeSmoke(runId: string): GuidedWorkerPlanState {
  const plan = buildReadmeSmokeWorkerPlan(runId);
  return {
    summary: plan.summary,
    operations: plan.operations,
  };
}

function previewSummary(items: WorkerPlanPreviewItem[]): string {
  if (items.length === 0) {
    return "No file operations are ready yet.";
  }
  return `This plan will ${items
    .map((item) => `${item.description}: ${item.path}`)
    .join("; ")}.`;
}

function previewJsonText(
  runId: string,
  builder: GuidedWorkerPlanState,
): { json: string; errors: string[] } {
  const result = buildGuidedWorkerPlan({
    runId,
    summary: builder.summary,
    operations: builder.operations,
  });
  return {
    json: result.plan ? JSON.stringify(result.plan, null, 2) : "",
    errors: result.errors,
  };
}

export function WorkerPlanPanel({
  runId,
  taskTitle,
  taskDescription,
  showReadmeSmokeHelper,
  incomingPlanJson,
}: {
  runId: string;
  taskTitle: string;
  taskDescription: string;
  showReadmeSmokeHelper: boolean;
  incomingPlanJson?: string;
}) {
  const router = useRouter();
  const [planSource, setPlanSource] = useState<PlanSource>("guided");
  const [guidedBuilder, setGuidedBuilder] = useState<GuidedWorkerPlanState>({
    summary: taskTitle,
    operations: [{ ...EMPTY_OPERATION }],
  });
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkerPlanValidationResult | null>(null);
  const [execution, setExecution] = useState<WorkerPlanExecutionResult | null>(null);
  const [summary, setSummary] = useState<WorkerPlanReportSummary | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const appliedIncomingPlan = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!incomingPlanJson || incomingPlanJson === appliedIncomingPlan.current) {
      return;
    }
    appliedIncomingPlan.current = incomingPlanJson;
    setJsonText(incomingPlanJson);
    const nextBuilder = builderStateFromPlanJson(
      incomingPlanJson,
      runId,
      taskTitle,
      taskDescription,
    );
    if (nextBuilder) {
      setGuidedBuilder(nextBuilder);
      setPlanSource("guided");
    } else {
      setPlanSource("advanced");
    }
  }, [incomingPlanJson, runId, taskDescription, taskTitle]);

  const guidedBuild = useMemo(
    () =>
      buildGuidedWorkerPlan({
        runId,
        summary: guidedBuilder.summary,
        operations: guidedBuilder.operations,
      }),
    [guidedBuilder, runId],
  );

  const guidedJsonPreview = useMemo(
    () => previewJsonText(runId, guidedBuilder),
    [guidedBuilder, runId],
  );

  const advancedInspection = useMemo(
    () =>
      inspectWorkerPlanJsonInput({
        text: jsonText,
        currentRunId: runId,
        taskTitle,
        taskDescription,
      }),
    [jsonText, runId, taskDescription, taskTitle],
  );

  const guidedInspection = useMemo(
    () =>
      guidedBuild.plan
        ? inspectWorkerPlanJsonInput({
            text: JSON.stringify(guidedBuild.plan),
            currentRunId: runId,
            taskTitle,
            taskDescription,
          })
        : null,
    [guidedBuild.plan, runId, taskDescription, taskTitle],
  );

  const activePlan = planSource === "guided" ? guidedBuild.plan : advancedInspection.plan;
  const activePreviewItems =
    planSource === "guided" ? guidedInspection?.previewItems ?? [] : advancedInspection.previewItems;
  const activeIntentWarnings =
    planSource === "guided"
      ? guidedInspection?.intentWarnings ?? []
      : advancedInspection.intentWarnings;

  const guidedAllowedFiles = guidedBuild.plan?.allowedFiles ?? [];

  function updateOperation(
    index: number,
    key: keyof GuidedWorkerPlanOperationInput,
    value: string,
  ) {
    setGuidedBuilder((current) => ({
      ...current,
      operations: current.operations.map((operation, operationIndex) => {
        if (operationIndex !== index) {
          return operation;
        }
        if (key === "type") {
          return {
            ...operation,
            type: value as GuidedWorkerPlanOperationInput["type"],
          };
        }
        return {
          ...operation,
          [key]: value,
        };
      }) as GuidedWorkerPlanOperationInput[],
    }));
  }

  function addOperation() {
    setGuidedBuilder((current) => ({
      ...current,
      operations: [...current.operations, { ...EMPTY_OPERATION }],
    }));
  }

  function removeOperation(index: number) {
    setGuidedBuilder((current) => ({
      ...current,
      operations:
        current.operations.length === 1
          ? [{ ...EMPTY_OPERATION }]
          : current.operations.filter((_, operationIndex) => operationIndex !== index),
    }));
  }

  function syncGuidedJsonToAdvanced() {
    if (!guidedJsonPreview.json) return;
    setJsonText(guidedJsonPreview.json);
  }

  function populateReadmeSmokePlan() {
    const nextBuilder = builderStateFromReadmeSmoke(runId);
    setGuidedBuilder(nextBuilder);
    const preview = previewJsonText(runId, nextBuilder);
    setJsonText(preview.json);
    setPlanSource("guided");
  }

  function handleInsertRunId() {
    const next = jsonText.trim();
    if (!next) {
      setJsonText(
        JSON.stringify(
          {
            runId,
            summary: "",
            allowedFiles: [],
            operations: [],
          },
          null,
          2,
        ),
      );
      setPlanSource("advanced");
      return;
    }

    if (next.includes("PASTE_NEW_RUN_ID_HERE") || next.includes("REPLACE_WITH_RUN_ID")) {
      setJsonText(
        jsonText
          .replaceAll("PASTE_NEW_RUN_ID_HERE", runId)
          .replaceAll("REPLACE_WITH_RUN_ID", runId),
      );
      setPlanSource("advanced");
      return;
    }

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      setJsonText(
        JSON.stringify(
          {
            ...parsed,
            runId,
          },
          null,
          2,
        ),
      );
      setPlanSource("advanced");
    } catch {
      setError("Fix the advanced JSON first, then insert the current runId.");
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setValidation(null);
    setExecution(null);
    setSummary(null);
    setRunStatus(null);

    let plan: unknown = null;
    if (planSource === "guided") {
      if (!guidedBuild.plan) {
        setError(guidedBuild.errors[0] ?? "Guided worker plan is incomplete.");
        setLoading(false);
        return;
      }
      plan = guidedBuild.plan;
    } else {
      if (!advancedInspection.plan || advancedInspection.jsonStatus !== "valid") {
        setError(advancedInspection.parseError ?? "This is not valid worker-plan JSON.");
        setLoading(false);
        return;
      }
      plan = advancedInspection.plan;
    }

    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/worker-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        },
      );
      const data = await res.json();
      if (data.validation) setValidation(data.validation);
      if (data.execution) setExecution(data.execution);
      if (data.workerPlanSummary) setSummary(data.workerPlanSummary);
      if (data.runStatus) setRunStatus(data.runStatus);

      if (!res.ok) {
        setError(data.error ?? "Worker plan validation or execution failed");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-600/40 bg-[var(--card)] p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Worker plan</h2>
            <OperatorHelp term="worker_plan" label="What is a worker plan?" />
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Use the guided builder for common plans. Advanced JSON stays available below for
            manual editing. Validation, execution, and governance behavior are unchanged.
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded border border-[var(--border)] p-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-[var(--muted)]">Current runId</p>
          <p className="font-mono text-xs">{runId}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Execution source</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPlanSource("guided")}
              className={`rounded border px-3 py-1.5 text-sm ${
                planSource === "guided"
                  ? "border-amber-500 bg-amber-500/20 text-amber-100"
                  : "border-[var(--border)]"
              }`}
            >
              Guided builder
            </button>
            <button
              type="button"
              onClick={() => setPlanSource("advanced")}
              className={`rounded border px-3 py-1.5 text-sm ${
                planSource === "advanced"
                  ? "border-amber-500 bg-amber-500/20 text-amber-100"
                  : "border-[var(--border)]"
              }`}
            >
              Advanced JSON
            </button>
          </div>
        </div>
      </div>

      <section className="mb-4 rounded border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Guided worker-plan builder</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Build a simple plan without manually typing `runId` or raw JSON.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showReadmeSmokeHelper && (
              <button
                type="button"
                onClick={populateReadmeSmokePlan}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
              >
                Create README smoke plan
              </button>
            )}
            <button
              type="button"
              onClick={syncGuidedJsonToAdvanced}
              disabled={!guidedJsonPreview.json}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Copy to advanced JSON
            </button>
            <button
              type="button"
              onClick={addOperation}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Add operation
            </button>
          </div>
        </div>

        <label className="mt-4 block text-sm">
          Summary
          <input
            value={guidedBuilder.summary}
            onChange={(event) =>
              setGuidedBuilder((current) => ({
                ...current,
                summary: event.target.value,
              }))
            }
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
            placeholder="Describe what this worker plan should do"
          />
        </label>

        <div className="mt-4">
          <h4 className="text-sm font-medium">Allowed files</h4>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Guided mode keeps `allowedFiles` aligned to the operation paths below.
          </p>
          <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] p-3">
            {guidedAllowedFiles.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No allowed files yet.</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {guidedAllowedFiles.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {guidedBuilder.operations.map((operation, index) => (
            <div key={`${index}-${operation.path}-${operation.type}`} className="rounded border border-[var(--border)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Operation {index + 1}</h4>
                <button
                  type="button"
                  onClick={() => removeOperation(index)}
                  className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Type
                  <select
                    value={operation.type}
                    onChange={(event) => updateOperation(index, "type", event.target.value)}
                    className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  >
                    <option value="create_file">create_file</option>
                    <option value="update_file">update_file</option>
                    <option value="append_file">append_file</option>
                  </select>
                </label>

                <label className="text-sm">
                  Path
                  <input
                    value={operation.path}
                    onChange={(event) => updateOperation(index, "path", event.target.value)}
                    className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-xs"
                    placeholder="README.md"
                  />
                </label>
              </div>

              <label className="mt-3 block text-sm">
                Reason
                <input
                  value={operation.reason}
                  onChange={(event) => updateOperation(index, "reason", event.target.value)}
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  placeholder="Why this change is needed"
                />
              </label>

              <label className="mt-3 block text-sm">
                Content
                <textarea
                  value={operation.content}
                  onChange={(event) => updateOperation(index, "content", event.target.value)}
                  rows={6}
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-xs"
                  spellCheck={false}
                />
              </label>
            </div>
          ))}
        </div>

        {guidedJsonPreview.errors.length > 0 && (
          <ul className="mt-4 list-inside list-disc text-sm text-amber-300">
            {guidedJsonPreview.errors.map((builderError) => (
              <li key={builderError}>{builderError}</li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <h4 className="text-sm font-medium">Preview JSON</h4>
          {guidedJsonPreview.json ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--background)] p-3 font-mono text-xs">
              {guidedJsonPreview.json}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Complete the guided fields above to generate worker-plan JSON.
            </p>
          )}
        </div>
      </section>

      <section className="mb-4 rounded border border-[var(--border)] p-3">
        <h3 className="font-medium">Plan intent preview</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          This is guidance for the human reviewer. Existing backend validation still runs on
          submit.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded border border-[var(--border)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Task</p>
            <p className="mt-2 text-sm font-medium">{taskTitle}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">
              {taskDescription || "No task description recorded."}
            </p>
          </div>
          <div className="rounded border border-[var(--border)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Plan</p>
            {activePlan ? (
              <>
                <p className="mt-2 text-sm font-medium">{activePlan.summary}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">{previewSummary(activePreviewItems)}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {activePreviewItems.map((item) => (
                    <li key={`${item.type}-${item.path}`}>
                      <span className="font-mono text-xs">{item.path}</span> - {item.description}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                {planSource === "guided"
                  ? "Finish the guided builder to preview the execution plan."
                  : "Fix the advanced JSON to preview the execution plan."}
              </p>
            )}
          </div>
        </div>

        {activeIntentWarnings.length > 0 && (
          <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-200">Intent warnings</p>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-100">
              {activeIntentWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mb-4 rounded border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Advanced JSON editor</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Use this for advanced manual edits. Problems stay visible and are not corrected
              automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={handleInsertRunId}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Insert current runId
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <p>
            JSON status:{" "}
            <strong
              className={
                advancedInspection.jsonStatus === "valid"
                  ? "text-emerald-400"
                  : advancedInspection.jsonStatus === "invalid"
                    ? "text-[var(--danger)]"
                    : "text-[var(--muted)]"
              }
            >
              {advancedInspection.jsonStatus}
            </strong>
          </p>
          {advancedInspection.parseError && (
            <p className="text-[var(--danger)]">{advancedInspection.parseError}</p>
          )}
        </div>

        <textarea
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          rows={14}
          className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs"
          spellCheck={false}
        />

        {advancedInspection.shellWrapperWarnings.length > 0 && (
          <ul className="mt-3 list-inside list-disc text-sm text-amber-300">
            {advancedInspection.shellWrapperWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        {advancedInspection.placeholderWarnings.length > 0 && (
          <ul className="mt-3 list-inside list-disc text-sm text-amber-300">
            {advancedInspection.placeholderWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {loading
          ? "Validating & executing..."
          : `Validate and execute ${planSource === "guided" ? "guided worker plan" : "advanced JSON"}`}
      </button>

      <p className="mt-2 text-xs text-[var(--muted)]">
        Submitting validates, executes file operations, then runs quality gates. No commit,
        merge, or deploy occurs here.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      {runStatus && (
        <p className="mt-2 text-sm">
          Run status after worker plan: <strong>{runStatus}</strong>
        </p>
      )}

      {validation && !validation.valid && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--danger)]">Validation errors</h3>
          <ul className="list-inside list-disc text-sm text-red-300">
            {validation.errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>
                [{e.code}] {e.message}
                {e.path ? ` (${e.path})` : ""}
                {e.operationIndex !== undefined ? ` [op ${e.operationIndex}]` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation?.warnings && validation.warnings.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-amber-300">Warnings</h3>
          <ul className="list-inside list-disc text-sm text-amber-200">
            {validation.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                [{w.code}] {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {execution && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Execution:{" "}
            <strong className={execution.success ? "text-emerald-400" : "text-red-400"}>
              {execution.success ? "success" : "failed"}
            </strong>
          </p>
          {execution.executedOperations.length > 0 && (
            <div>
              <p className="font-medium">Executed operations</p>
              <ul className="mt-1 font-mono text-xs">
                {execution.executedOperations.map((op) => (
                  <li key={`${op.type}-${op.path}`}>
                    {op.type}: {op.path}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {execution.errors.length > 0 && (
            <ul className="list-inside list-disc text-red-300">
              {execution.errors.map((e, i) => (
                <li key={i}>
                  [{e.code}] {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {summary && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Plan summary: {summary.summary} · executed {summary.executedCount} operation(s)
        </p>
      )}
    </section>
  );
}
