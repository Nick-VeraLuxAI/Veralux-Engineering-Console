"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  WorkerPlanExecutionResult,
  WorkerPlanValidationResult,
} from "@/lib/engineer-console/worker-plan/worker-plan-types";
import type { WorkerPlanReportSummary } from "@/lib/engineer-console/types";

const EXAMPLE_PLAN = `{
  "runId": "REPLACE_WITH_RUN_ID",
  "summary": "Create initial estimating module files",
  "allowedFiles": [
    "src/example/file.ts"
  ],
  "operations": [
    {
      "type": "create_file",
      "path": "src/example/file.ts",
      "content": "export const value = true;\\n",
      "reason": "Create initial module file."
    }
  ]
}`;

export function WorkerPlanPanel({
  runId,
  planJson,
  onPlanJsonChange,
}: {
  runId: string;
  planJson?: string;
  onPlanJsonChange?: (json: string) => void;
}) {
  const router = useRouter();
  const [internalJson, setInternalJson] = useState(
    EXAMPLE_PLAN.replace("REPLACE_WITH_RUN_ID", runId),
  );
  const jsonText = planJson ?? internalJson;
  const setJsonText = onPlanJsonChange ?? setInternalJson;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkerPlanValidationResult | null>(null);
  const [execution, setExecution] = useState<WorkerPlanExecutionResult | null>(null);
  const [summary, setSummary] = useState<WorkerPlanReportSummary | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setValidation(null);
    setExecution(null);
    setSummary(null);
    setRunStatus(null);

    let plan: unknown;
    try {
      plan = JSON.parse(jsonText);
    } catch {
      setError("Invalid JSON. Fix syntax before submitting.");
      setLoading(false);
      return;
    }

    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/worker-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
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
          <h2 className="font-semibold">Worker plan</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Deterministic patch instructions (JSON). Validates, executes file operations, then
            runs quality gates. No commit, merge, or deploy.
          </p>
        </div>
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        rows={14}
        className="mb-3 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs"
        spellCheck={false}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {loading ? "Validating & executing…" : "Validate and execute worker plan"}
      </button>

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
