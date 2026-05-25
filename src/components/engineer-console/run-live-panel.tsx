"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { deriveRunCurrentActionZoneState } from "@/lib/engineer-console/run-ux/run-page-sections";
import {
  RUN_NAV_TARGET_IDS,
  buildRunExpertSummaryItems,
  buildRunQuickNavItems,
  resolveRunNavigationShortcut,
} from "@/lib/engineer-console/run-ux/run-navigation";
import { deriveRunIssues, type RunIssue } from "@/lib/engineer-console/run-ux/run-issues";
import {
  DEFAULT_RUN_WORKSPACE_VIEW,
  getRunWorkspaceViewForTarget,
  resolveRunWorkspaceViewForHash,
  type RunWorkspaceViewId,
} from "@/lib/engineer-console/run-ux/run-workspace";
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
import { RunCurrentActionZone } from "./run-current-action-zone";
import { RunQuickNav } from "./run-quick-nav";
import { RunExpertSummary } from "./run-expert-summary";
import { RunWorkspaceShell, RunWorkspaceViewPanel } from "./run-workspace-shell";
import { RunIssueCenter } from "./run-issue-center";
import { OperatorHelp } from "./operator-help";

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

type HistoryMode = "push" | "replace" | "none";

function issueToneClasses(severity: RunIssue["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-950/20 text-red-200";
    case "warning":
      return "border-amber-500/40 bg-amber-950/20 text-amber-200";
    default:
      return "border-blue-500/40 bg-blue-950/20 text-blue-200";
  }
}

export function RunLivePanel({ runId, initial }: { runId: string; initial: RunDetailPayload }) {
  const [data, setData] = useState(initial);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [incomingPlanJson, setIncomingPlanJson] = useState<string | undefined>(undefined);
  const [pendingShortcutPrefix, setPendingShortcutPrefix] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<RunWorkspaceViewId>(DEFAULT_RUN_WORKSPACE_VIEW);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const historyModeRef = useRef<HistoryMode>("none");
  const terminal = ["completed", "failed"].includes(data.run.status);

  useEffect(() => {
    setWorkspaceReady(true);
  }, []);

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
  const currentAction = deriveRunCurrentActionZoneState(data.uxSummary, guidance);
  const quickNavItems = buildRunQuickNavItems(data.uxSummary, guidance);
  const expertSummaryItems = buildRunExpertSummaryItems(data.uxSummary, guidance);
  const issues = deriveRunIssues(data.uxSummary, guidance);
  const currentIssue = issues[0] ?? null;
  const routedView = getRunWorkspaceViewForTarget(pendingTargetId);
  const visibleView = routedView ?? activeView;

  const selectView = useCallback((viewId: RunWorkspaceViewId) => {
    historyModeRef.current = "none";
    setPendingTargetId(null);
    setActiveView(viewId);
  }, []);

  const openViewPanel = useCallback((viewId: RunWorkspaceViewId, historyMode: HistoryMode = "none") => {
    historyModeRef.current = historyMode;
    setActiveView(viewId);
    setPendingTargetId(`run-workspace-panel-${viewId}`);
  }, []);

  const navigateToTarget = useCallback((targetId: string, historyMode: HistoryMode = "push") => {
    const nextView = getRunWorkspaceViewForTarget(targetId);
    historyModeRef.current = historyMode;
    if (nextView) {
      setActiveView(nextView);
    }
    setPendingTargetId(targetId);
  }, []);

  const openIssue = useCallback(
    (issue: RunIssue) => {
      historyModeRef.current = "push";
      setActiveView(issue.view);
      setPendingTargetId(issue.anchorId ?? `run-workspace-panel-${issue.view}`);
    },
    [],
  );

  useLayoutEffect(() => {
    function applyHashNavigation(targetId: string) {
      if (!targetId) return;
      const nextView = resolveRunWorkspaceViewForHash(`#${targetId}`);
      if (nextView) {
        setActiveView(nextView);
      }
      historyModeRef.current = "none";
      setPendingTargetId(targetId);
    }

    function onHashChange() {
      applyHashNavigation(window.location.hash.slice(1));
    }

    applyHashNavigation(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!pendingShortcutPrefix) return;
    const timeout = window.setTimeout(() => setPendingShortcutPrefix(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [pendingShortcutPrefix]);

  useEffect(() => {
    if (!pendingTargetId) return;
    const targetId = pendingTargetId;

    window.requestAnimationFrame(() => {
      const target =
        document.getElementById(targetId) ?? document.getElementById(`run-workspace-panel-${visibleView}`);
      if (!target) {
        historyModeRef.current = "none";
        setPendingTargetId(null);
        return;
      }

      const details = target instanceof HTMLDetailsElement ? target : target.closest("details");
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
      }

      if (historyModeRef.current === "push") {
        window.history.pushState(null, "", `#${targetId}`);
      } else if (historyModeRef.current === "replace") {
        window.history.replaceState(null, "", `#${targetId}`);
      }
      historyModeRef.current = "none";
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true });
      }
      setPendingTargetId(null);
    });
  }, [pendingTargetId, visibleView]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const result = resolveRunNavigationShortcut({
        pendingPrefix: pendingShortcutPrefix,
        key: event.key,
        target: event.target,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      });

      if (result.nextPendingPrefix !== pendingShortcutPrefix) {
        setPendingShortcutPrefix(result.nextPendingPrefix);
      }
      if (!result.targetId) return;

      event.preventDefault();
      navigateToTarget(result.targetId, "push");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateToTarget, pendingShortcutPrefix]);

  const handleAnchorNavigation = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href^='#']");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;

      event.preventDefault();
      navigateToTarget(decodeURIComponent(href.slice(1)), "push");
    },
    [navigateToTarget],
  );

  return (
    <div
      className="space-y-6"
      data-run-workspace-ready={workspaceReady ? "true" : "false"}
      onClickCapture={handleAnchorNavigation}
    >
      <RunWorkspaceShell
        taskTitle={data.task.title}
        runIdShort={data.run.id.slice(0, 8)}
        runStatus={data.run.status}
        currentStageLabel={guidance.currentStageLabel}
        riskLevel={data.run.riskLevel}
        blockerCount={guidance.blockers.length}
        warningCount={guidance.warnings.length}
        nextAction={guidance.nextRecommendedAction}
        activeView={visibleView}
        onSelectView={selectView}
        currentIssue={currentIssue}
        onOpenCurrentIssue={() => {
          if (currentIssue) {
            openIssue(currentIssue);
            return;
          }
          openViewPanel(visibleView);
        }}
      >
        <RunWorkspaceViewPanel viewId="overview" activeView={visibleView}>
          <div id="run-command-center" className="scroll-mt-28">
            <RunCommandCenter summary={data.uxSummary} guidance={guidance} />
          </div>

          <div id="run-lifecycle" className="scroll-mt-28">
            <RunLifecycleStepper steps={lifecycleSteps} currentStageId={guidance.currentStageId} />
          </div>

          <div id="run-quick-nav" className="scroll-mt-28">
            <RunQuickNav items={quickNavItems} />
          </div>

          <div id="run-expert-summary" className="scroll-mt-28">
            <RunExpertSummary items={expertSummaryItems} />
          </div>

          <div id={RUN_NAV_TARGET_IDS.currentAction} className="scroll-mt-28">
            <RunCurrentActionZone state={currentAction} />
          </div>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="mb-3 font-semibold">Overview attention</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              What this is: the top derived issues for the current run. Why it matters: it lets the
              operator route directly to the most important open problem without scanning the full
              workspace. What to do next: open the highest-priority issue below or use the Issue
              Center overlay.
            </p>
            {issues.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No active issues are derived right now.</p>
            ) : (
              <ul className="space-y-3">
                {issues.slice(0, 4).map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      onClick={() => openIssue(issue)}
                      className="block w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-left hover:border-white/20"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${issueToneClasses(issue.severity)}`}>
                          {issue.severity}
                        </span>
                        <span className="text-sm font-medium text-white">{issue.title}</span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">{issue.message}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            id={RUN_PANEL_IDS.runState}
            className="scroll-mt-28 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            tabIndex={-1}
          >
            <h2 className="mb-3 font-semibold">Run state</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              What this is: the recorded run status, branch, and risk summary. Why it matters: it
              confirms the base context for every later workspace view. What to do next: use the
              Current Action and Overview attention cards first, then return here if the run status
              or branch looks unexpected.
            </p>
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
                <dd>{data.run.riskLevel ? <StatusBadge status={data.run.riskLevel} /> : "—"}</dd>
              </div>
            </dl>
            {data.run.agentMessage ? (
              <p className="mt-3 rounded bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
                {data.run.agentMessage}
              </p>
            ) : null}
          </section>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="work_plan" activeView={visibleView}>
          <div id="active-work" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <WorkerPlanDraftPanel
              runId={runId}
              taskTitle={data.task.title}
              taskDescription={data.task.description}
              initialDraft={data.workerPlanDraft ?? null}
              onUseDraftPlan={(json) => setIncomingPlanJson(json)}
            />

            <div id={RUN_PANEL_IDS.workerPlan} className="scroll-mt-28" tabIndex={-1}>
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
              className="scroll-mt-28 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
              tabIndex={-1}
            >
              <h2 className="mb-3 font-semibold">Changed files</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                What this is: the file-level change list for the current run. Why it matters: it
                lets the operator confirm scope before review or PR work. What to do next: check
                that only expected files are present.
              </p>
              {data.changedFiles.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No changed files detected yet.</p>
              ) : (
                <ul className="max-h-48 overflow-auto font-mono text-xs">
                  {data.changedFiles.map((file) => (
                    <li key={file} className="border-b border-[var(--border)] py-1">
                      {file}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              id={RUN_PANEL_IDS.qualityGates}
              className="scroll-mt-28 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
              tabIndex={-1}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Quality gates</h2>
                <OperatorHelp term="quality_gates" label="What are quality gates?" />
              </div>
              <p className="mb-3 text-sm text-[var(--muted)]">
                What this is: recorded gate results for build, test, lint, and related checks. Why
                it matters: failed gates block later review and release work. What to do next:
                review failures or confirm the run is ready to move forward.
              </p>
              {data.qualityGates.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No quality gate results yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.qualityGates.map((gate) => (
                    <div key={gate.id} className="rounded border border-[var(--border)] p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <code>{gate.command}</code>
                        <StatusBadge status={gate.status} />
                      </div>
                      <p className="text-xs text-[var(--muted)]">
                        exit {gate.exitCode} · {gate.durationMs}ms
                      </p>
                      {gate.stdout ? (
                        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs">
                          {gate.stdout.slice(0, 4000)}
                        </pre>
                      ) : null}
                      {gate.stderr ? (
                        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs text-red-300">
                          {gate.stderr.slice(0, 4000)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="review" activeView={visibleView}>
          <div id="governance-review" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <RunApprovalActionCard runId={runId} state={approvalCardState} />

            <div id={RUN_PANEL_IDS.evidence} className="scroll-mt-28" tabIndex={-1}>
              <EvidenceBundlePanel runId={runId} />
            </div>

            <DecisionHistoryPanel runId={runId} />

            <div id={RUN_PANEL_IDS.replay} className="scroll-mt-28" tabIndex={-1}>
              <ReplayVerificationPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.policy} className="scroll-mt-28" tabIndex={-1}>
              <PolicyResultsPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.reviewStages} className="scroll-mt-28" tabIndex={-1}>
              <ReviewStagesPanel runId={runId} workflowSummary={data.uxSummary} />
            </div>

            {report ? (
              <section
                id={RUN_PANEL_IDS.approval}
                className="scroll-mt-28 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
                tabIndex={-1}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">Approval report</h2>
                  <OperatorHelp term="approval_report" label="What is the approval report?" />
                </div>
                <p className="mb-2 text-sm text-[var(--muted)]">
                  What this is: the detailed approval report for the run. Why it matters: it
                  preserves the same auditable approval data and controls used by the approval action
                  card. What to do next: review the report details, then record the human decision
                  if the run is ready.
                </p>
                <p className="mb-2 text-sm">{report.taskSummary}</p>
                <p className="mb-2 text-sm text-[var(--muted)]">{report.recommendedNextAction}</p>
                {report.workerPlan ? (
                  <div className="mb-3 rounded border border-[var(--border)] p-3 text-sm">
                    <p className="font-medium">Worker plan: {report.workerPlan.summary}</p>
                    <p className="text-xs text-[var(--muted)]">
                      validation {report.workerPlan.validationStatus} · execution{" "}
                      {report.workerPlan.executionStatus} · {report.workerPlan.executedCount}{" "}
                      operation(s)
                    </p>
                  </div>
                ) : null}
                {report.governanceIssues.length > 0 ? (
                  <ul className="mb-3 list-inside list-disc text-sm text-amber-300">
                    {report.governanceIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
                <pre className="mb-4 max-h-40 overflow-auto rounded bg-[var(--background)] p-3 text-xs">
                  {report.diffSummary}
                </pre>
                {(approvalCardState.showApprove ||
                  approvalCardState.showRequestFix ||
                  approvalCardState.showStop) ? (
                  <ApprovalActions
                    runId={runId}
                    canApprove={approvalCardState.approvalAvailable}
                    approvalRequiresRationale={approvalCardState.rationale.approve === "required"}
                    showApprove={approvalCardState.showApprove}
                    showRequestFix={approvalCardState.showRequestFix}
                    showStop={approvalCardState.showStop}
                    rationaleGuidance={approvalCardState.rationale.guidance}
                  />
                ) : null}
              </section>
            ) : null}
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="pr" activeView={visibleView}>
          <div id={RUN_PANEL_IDS.prCreation} className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <PrCreationPanel runId={runId} />
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="release" activeView={visibleView}>
          <div id="pr-release" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <div id={RUN_PANEL_IDS.mergeControls} className="scroll-mt-28" tabIndex={-1}>
              <MergeControlsPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.deploymentGates} className="scroll-mt-28" tabIndex={-1}>
              <DeploymentGatesPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.deploymentExecution} className="scroll-mt-28" tabIndex={-1}>
              <DeploymentExecutionPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.deploymentHealth} className="scroll-mt-28" tabIndex={-1}>
              <DeploymentHealthChecksPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.deploymentHealthPolicy} className="scroll-mt-28" tabIndex={-1}>
              <DeploymentHealthPolicyPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.releaseChecklist} className="scroll-mt-28" tabIndex={-1}>
              <ReleaseChecklistPanel runId={runId} />
            </div>

            <div id={RUN_PANEL_IDS.releaseSignoff} className="scroll-mt-28" tabIndex={-1}>
              <ReleaseSignoffPanel runId={runId} />
            </div>
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="audit" activeView={visibleView}>
          <div id="technical-audit" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="mb-3 font-semibold">Audit overview</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                What this is: the audit-focused workspace for timeline verification and technical
                traceability. Why it matters: audit history and chain diagnostics remain accessible
                even when the main operator flow is focused on another workspace view. What to do
                next: inspect the timeline, then open chain diagnostics if verification failed.
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                  <dt className="text-[var(--muted)]">Audit events</dt>
                  <dd className="mt-1 text-white">{data.uxSummary.audit.eventCount}</dd>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                  <dt className="text-[var(--muted)]">Chain status</dt>
                  <dd className="mt-1 text-white">
                    {data.uxSummary.audit.chainOk ? "verified" : "failed"}
                  </dd>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                  <dt className="text-[var(--muted)]">Chain failures</dt>
                  <dd className="mt-1 text-white">{data.uxSummary.audit.chainFailureCount}</dd>
                </div>
              </dl>
            </section>

            <div id={RUN_PANEL_IDS.auditTimeline} className="scroll-mt-28" tabIndex={-1}>
              <AuditTimelinePanel runId={runId} />
            </div>
          </div>
        </RunWorkspaceViewPanel>
      </RunWorkspaceShell>

      <RunIssueCenter issues={issues} onOpenIssue={openIssue} />
    </div>
  );
}
