"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useEffect, useState } from "react";
import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import {
  deriveRunCommandCenterState,
  deriveRunApprovalActionCardState,
  deriveRunLifecycleSteps,
} from "@/lib/engineer-console/run-ux/derive-run-ux";
import {
  RUN_PANEL_IDS,
  type RunWorkflowSummary,
} from "@/lib/engineer-console/run-ux/run-ux-types";
import { StatusBadge } from "./status-badge";
import { ApprovalActions } from "./approval-actions";
import { WorkerPlanPanel } from "./worker-plan-panel";
import {
  WorkerPlanDraftPanel,
  type WorkerPlanDraftPayload,
} from "./worker-plan-draft-panel";
import { AuditTimelinePanel } from "./audit-timeline-panel";
import { EvidenceBundlePanel } from "./evidence-bundle-panel";
import { DecisionHistoryPanel } from "./decision-history-panel";
import { ReplayVerificationPanel } from "./replay-verification-panel";
import { PolicyResultsPanel } from "./policy-results-panel";
import { ReviewStagesPanel } from "./review-stages-panel";
import { PrCreationPanel } from "./pr-creation-panel";
import { MergeControlsPanel } from "./merge-controls-panel";
import { DeploymentGatesPanel } from "./deployment-gates-panel";
import { DeploymentExecutionPanel } from "./deployment-execution-panel";
import { DeploymentHealthChecksPanel } from "./deployment-health-checks-panel";
import { DeploymentHealthPolicyPanel } from "./deployment-health-policy-panel";
import { ReleaseChecklistPanel } from "./release-checklist-panel";
import { ReleaseSignoffPanel } from "./release-signoff-panel";
import { RunCommandCenter } from "./run-command-center";
import { RunLifecycleStepper } from "./run-lifecycle-stepper";
import { RunApprovalActionCard } from "./run-approval-action-card";

interface RunDetailPayload {
  run: EngineeringRun;
  task: EngineeringTask;
  changedFiles: string[];
  diffSummary: string;
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
  workerPlanDraft?: WorkerPlanDraftPayload | null;
  uxSummary: RunWorkflowSummary;
}

export function RunLivePanel({ runId, initial }: { runId: string; initial: RunDetailPayload }) {
  const [data, setData] = useState(initial);
  const [incomingPlanJson, setIncomingPlanJson] = useState<string | undefined>(undefined);
  const terminal = ["completed", "failed"].includes(data.run.status);

  useEffect(() => {
    if (terminal) return;
    const interval = setInterval(async () => {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}`);
      if (res.ok) {
        setData(await res.json());
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [runId, terminal]);

  const report = data.approvalReport;
  const guidance = deriveRunCommandCenterState(data.uxSummary);
  const approvalCardState = deriveRunApprovalActionCardState(data.uxSummary);
  const lifecycleSteps = deriveRunLifecycleSteps(data.uxSummary);

  return (
    <div className="space-y-6">
      <RunCommandCenter summary={data.uxSummary} guidance={guidance} />

      <RunApprovalActionCard runId={runId} state={approvalCardState} />

      <RunLifecycleStepper
        steps={lifecycleSteps}
        currentStageId={guidance.currentStageId}
      />

      <section
        id={RUN_PANEL_IDS.runState}
        className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
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

      <div
        id={RUN_PANEL_IDS.auditTimeline}
        className="scroll-mt-24"
      >
        <AuditTimelinePanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.evidence} className="scroll-mt-24">
        <EvidenceBundlePanel runId={runId} />
      </div>
      <DecisionHistoryPanel runId={runId} />
      <div id={RUN_PANEL_IDS.replay} className="scroll-mt-24">
        <ReplayVerificationPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.policy} className="scroll-mt-24">
        <PolicyResultsPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.reviewStages} className="scroll-mt-24">
        <ReviewStagesPanel runId={runId} workflowSummary={data.uxSummary} />
      </div>
      <div id={RUN_PANEL_IDS.prCreation} className="scroll-mt-24">
        <PrCreationPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.mergeControls} className="scroll-mt-24">
        <MergeControlsPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.deploymentGates} className="scroll-mt-24">
        <DeploymentGatesPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.deploymentExecution} className="scroll-mt-24">
        <DeploymentExecutionPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.deploymentHealth} className="scroll-mt-24">
        <DeploymentHealthChecksPanel runId={runId} />
      </div>
      <div
        id={RUN_PANEL_IDS.deploymentHealthPolicy}
        className="scroll-mt-24"
      >
        <DeploymentHealthPolicyPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.releaseChecklist} className="scroll-mt-24">
        <ReleaseChecklistPanel runId={runId} />
      </div>
      <div id={RUN_PANEL_IDS.releaseSignoff} className="scroll-mt-24">
        <ReleaseSignoffPanel runId={runId} />
      </div>

      <WorkerPlanDraftPanel
        runId={runId}
        taskTitle={data.task.title}
        taskDescription={data.task.description}
        initialDraft={data.workerPlanDraft ?? null}
        onUseDraftPlan={(json) => setIncomingPlanJson(json)}
      />
      <div id={RUN_PANEL_IDS.workerPlan} className="scroll-mt-24">
        <WorkerPlanPanel
          runId={runId}
          taskTitle={data.task.title}
          taskDescription={data.task.description}
          showReadmeSmokeHelper={data.uxSummary.workerPlan.showReadmeSmokeHelper}
          incomingPlanJson={incomingPlanJson}
        />
      </div>

      <section
        id={RUN_PANEL_IDS.changedFiles}
        className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
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

      <section
        id={RUN_PANEL_IDS.qualityGates}
        className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
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
        <section
          id={RUN_PANEL_IDS.approval}
          className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <h2 className="mb-3 font-semibold">Approval report</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            The approval action card near the top of the page summarizes what to do next. This
            panel keeps the detailed approval report and the same auditable action controls.
          </p>
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
          {(approvalCardState.showApprove ||
            approvalCardState.showRequestFix ||
            approvalCardState.showStop) && (
            <ApprovalActions
              runId={runId}
              canApprove={approvalCardState.approvalAvailable}
              approvalRequiresRationale={approvalCardState.rationale.approve === "required"}
              showApprove={approvalCardState.showApprove}
              showRequestFix={approvalCardState.showRequestFix}
              showStop={approvalCardState.showStop}
              rationaleGuidance={approvalCardState.rationale.guidance}
            />
          )}
        </section>
      )}
    </div>
  );
}
