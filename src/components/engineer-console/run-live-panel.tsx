"use client";

import { useEffect, useState } from "react";
import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import { StatusBadge } from "./status-badge";
import { ApprovalActions } from "./approval-actions";
import { WorkerPlanPanel } from "./worker-plan-panel";
import { WorkerPlanDraftPanel } from "./worker-plan-draft-panel";
import { AuditTimelinePanel } from "./audit-timeline-panel";
import { EvidenceBundlePanel } from "./evidence-bundle-panel";
import { DecisionHistoryPanel } from "./decision-history-panel";
import { ReplayVerificationPanel } from "./replay-verification-panel";
import { PolicyResultsPanel } from "./policy-results-panel";
import { ReviewStagesPanel } from "./review-stages-panel";

interface RunDetailPayload {
  run: EngineeringRun;
  task: EngineeringTask;
  changedFiles: string[];
  diffSummary: string;
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
}

export function RunLivePanel({ runId, initial }: { runId: string; initial: RunDetailPayload }) {
  const [data, setData] = useState(initial);
  const [manualPlanJson, setManualPlanJson] = useState<string | undefined>(undefined);
  const terminal = ["completed", "failed"].includes(data.run.status);

  useEffect(() => {
    if (terminal) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/engineer-console/runs/${runId}`);
      if (res.ok) {
        setData(await res.json());
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [runId, terminal]);

  const report = data.approvalReport;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 font-semibold">Run state</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Status</dt>
            <dd>
              <StatusBadge status={data.run.status} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Current step</dt>
            <dd>{data.run.currentStep ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Branch</dt>
            <dd className="font-mono text-xs">{data.run.branchName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Risk level</dt>
            <dd>
              {data.run.riskLevel ? <StatusBadge status={data.run.riskLevel} /> : "—"}
            </dd>
          </div>
        </dl>
        {data.run.agentMessage && (
          <p className="mt-3 rounded bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
            {data.run.agentMessage}
          </p>
        )}
      </section>

      <AuditTimelinePanel runId={runId} />
      <EvidenceBundlePanel runId={runId} />
      <DecisionHistoryPanel runId={runId} />
      <ReplayVerificationPanel runId={runId} />
      <PolicyResultsPanel runId={runId} />
      <ReviewStagesPanel runId={runId} />

      <WorkerPlanDraftPanel
        runId={runId}
        onCopyToWorkerPlan={(json) => setManualPlanJson(json)}
      />
      <WorkerPlanPanel
        runId={runId}
        planJson={manualPlanJson}
        onPlanJsonChange={setManualPlanJson}
      />

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 font-semibold">Changed files</h2>
        {data.changedFiles.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No changed files detected yet.</p>
        ) : (
          <ul className="max-h-48 overflow-auto font-mono text-xs">
            {data.changedFiles.map((f) => (
              <li key={f} className="border-b border-[var(--border)] py-1">
                {f}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 font-semibold">Quality gates</h2>
        {data.qualityGates.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No quality gate results yet.</p>
        ) : (
          <div className="space-y-3">
            {data.qualityGates.map((g) => (
              <div key={g.id} className="rounded border border-[var(--border)] p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <code>{g.command}</code>
                  <StatusBadge status={g.status} />
                </div>
                <p className="text-xs text-[var(--muted)]">
                  exit {g.exitCode} · {g.durationMs}ms
                </p>
                {g.stdout && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs">
                    {g.stdout.slice(0, 4000)}
                  </pre>
                )}
                {g.stderr && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs text-red-300">
                    {g.stderr.slice(0, 4000)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {report && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-3 font-semibold">Approval report</h2>
          <p className="mb-2 text-sm">{report.taskSummary}</p>
          <p className="mb-2 text-sm text-[var(--muted)]">{report.recommendedNextAction}</p>
          {report.workerPlan && (
            <div className="mb-3 rounded border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">Worker plan: {report.workerPlan.summary}</p>
              <p className="text-xs text-[var(--muted)]">
                validation {report.workerPlan.validationStatus} · execution{" "}
                {report.workerPlan.executionStatus} · {report.workerPlan.executedCount}{" "}
                operation(s)
              </p>
            </div>
          )}
          {report.governanceIssues.length > 0 && (
            <ul className="mb-3 list-inside list-disc text-sm text-amber-300">
              {report.governanceIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <pre className="mb-4 max-h-40 overflow-auto rounded bg-[var(--background)] p-3 text-xs">
            {report.diffSummary}
          </pre>
          {data.run.status === "waiting_for_approval" && (
            <ApprovalActions runId={runId} canApprove={report.canApprove} />
          )}
        </section>
      )}
    </div>
  );
}
