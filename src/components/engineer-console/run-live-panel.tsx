"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { buildRunDecisionBrief } from "@/lib/engineer-console/run-ux/run-decision-brief";
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
  operatorTabForView,
  resolveRunWorkspaceViewForHash,
  type RunOperatorTabId,
  type RunWorkspaceViewId,
} from "@/lib/engineer-console/run-ux/run-workspace";
import { Surface } from "@/components/ui/surface";
import { StatusBadge } from "./status-badge";
import { CommitCandidatePanel } from "./commit-candidate-panel";
import { EngineeringReviewSignoffPanel } from "./engineering-review-signoff-panel";
import { HermesWorkerPanel } from "./hermes-worker-panel";
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
import { RunDecisionPanel } from "./run-decision-dialog";
import { RunCurrentActionZone } from "./run-current-action-zone";
import { RunQuickNav } from "./run-quick-nav";
import { RunExpertSummary } from "./run-expert-summary";
import { RunWorkspaceShell, RunWorkspaceViewPanel } from "./run-workspace-shell";
import { RunIssueCenter } from "./run-issue-center";
import { OperatorHelp } from "./operator-help";
import {
  AutonomousEngineerPanel,
  type AutonomousProgressPayload,
} from "./autonomous-engineer-panel";
import { SeniorReviewPanel } from "./senior-review-panel";

interface RunDetailPayload {
  run: EngineeringRun;
  task: EngineeringTask;
  changedFiles: string[];
  diffSummary: string;
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
  workerPlanDraft?: WorkerPlanDraftPayload | null;
  uxSummary: RunWorkflowSummary;
  autonomous?: AutonomousProgressPayload | null;
}

type HistoryMode = "push" | "replace" | "none";

export function RunLivePanel({
  runId,
  initial,
  veraExecutionBlocked = false,
}: {
  runId: string;
  initial: RunDetailPayload;
  veraExecutionBlocked?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [incomingPlanJson, setIncomingPlanJson] = useState<string | undefined>(undefined);
  const [pendingShortcutPrefix, setPendingShortcutPrefix] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<RunWorkspaceViewId>(DEFAULT_RUN_WORKSPACE_VIEW);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const historyModeRef = useRef<HistoryMode>("none");
  const terminal = ["completed", "failed", "exhausted", "aborted"].includes(data.run.status);

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
  const needsDecision =
    approvalCardState.showCard &&
    (data.run.status === "waiting_for_approval" ||
      approvalCardState.showApprove ||
      approvalCardState.showRequestFix);
  const skippedGates = data.qualityGates.some((gate) => gate.status === "skipped");
  const pendingReview = data.uxSummary.review.pendingCount > 0;
  const decisionBrief = useMemo(
    () =>
      buildRunDecisionBrief({
        taskTitle: data.task.title,
        happening: pendingReview || skippedGates
          ? "The worker finished a change. Automatic tests did not fully run, or policy asked a person to look, so this job is waiting on you."
          : [currentAction.description, approvalCardState.currentStateDetail]
              .filter(Boolean)
              .join(" "),
        recommendation:
          data.approvalReport?.recommendedNextAction?.trim() || approvalCardState.nextRequiredAction,
        canApprove: approvalCardState.approvalAvailable,
        hardBlocked:
          data.uxSummary.policy.status === "blocked" || data.uxSummary.review.rejectedCount > 0,
        changedFiles: data.changedFiles,
        qualityGates: data.qualityGates,
        governanceIssues:
          data.approvalReport?.governanceIssues ?? data.uxSummary.approval.governanceIssues,
        extraIssues: approvalCardState.blockers.map((item) => item.text),
        pendingReviewCount: data.uxSummary.review.pendingCount,
      }),
    [
      approvalCardState.approvalAvailable,
      approvalCardState.blockers,
      approvalCardState.currentStateDetail,
      approvalCardState.nextRequiredAction,
      currentAction.description,
      data.approvalReport?.governanceIssues,
      data.approvalReport?.recommendedNextAction,
      data.changedFiles,
      data.qualityGates,
      data.task.title,
      data.uxSummary.approval.governanceIssues,
      data.uxSummary.policy.status,
      data.uxSummary.review.pendingCount,
      data.uxSummary.review.rejectedCount,
      pendingReview,
      skippedGates,
    ],
  );
  const quickNavItems = buildRunQuickNavItems(data.uxSummary, guidance);
  const expertSummaryItems = buildRunExpertSummaryItems(data.uxSummary, guidance);
  const issues = deriveRunIssues(data.uxSummary, guidance);
  const currentIssue = issues[0] ?? null;
  const viewIssueCounts = useMemo(() => {
    return issues.reduce<Partial<Record<RunOperatorTabId, number>>>((counts, issue) => {
      const tab = operatorTabForView(issue.view);
      counts[tab] = (counts[tab] ?? 0) + 1;
      return counts;
    }, {});
  }, [issues]);
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
        viewIssueCounts={viewIssueCounts}
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
          <div className="space-y-4">
            <div id={RUN_NAV_TARGET_IDS.currentAction} className="scroll-mt-28">
              <RunCurrentActionZone state={currentAction} hidePrimary={needsDecision} />
            </div>

            {needsDecision ? (
              <RunDecisionPanel
                runId={runId}
                brief={decisionBrief}
                approval={approvalCardState}
              />
            ) : null}

            <details id="run-command-center" className="scroll-mt-28 rounded-xl border border-white/8 px-4 py-3">
              <summary className="cursor-pointer text-sm text-white/55">
                <h2 className="inline text-sm font-medium text-white/70">More status (optional)</h2>
              </summary>
              <div className="mt-4 space-y-4">
                <RunCommandCenter summary={data.uxSummary} guidance={guidance} />
                <div id="run-lifecycle">
                  <RunLifecycleStepper steps={lifecycleSteps} currentStageId={guidance.currentStageId} />
                </div>
                <div id="run-quick-nav">
                  <RunQuickNav items={quickNavItems} />
                </div>
                <div id="run-expert-summary">
                  <RunExpertSummary items={expertSummaryItems} />
                </div>
              </div>
            </details>

            {data.autonomous ? (
              <details className="rounded-xl border border-white/8 px-4 py-3">
                <summary className="cursor-pointer text-sm text-white/55">
                  <h2 className="inline text-sm font-medium text-white/70">Autonomous Engineer (optional)</h2>
                </summary>
                <div className="mt-4 space-y-4">
                  <AutonomousEngineerPanel runId={runId} payload={data.autonomous} />
                  <SeniorReviewPanel runId={runId} />
                </div>
              </details>
            ) : null}

            <details
              className="rounded-xl border border-white/8 px-4 py-3"
            >
              <summary className="cursor-pointer text-sm text-white/55">
                <h2 className="inline text-sm font-medium text-white/70">Job record (optional)</h2>
              </summary>
              <div className="mt-4">
            <Surface
              as="section"
              id={RUN_PANEL_IDS.runState}
            className="scroll-mt-28"
            tabIndex={-1}
          >
            <h2 className="mb-3 font-semibold">Run state</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              Branch, status, and risk for this job. You can ignore this unless something looks off.
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
              <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface-inset)] p-3 text-sm text-[var(--muted)]">
                {data.run.agentMessage}
              </p>
            ) : null}
          </Surface>
              </div>
            </details>
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="work_plan" activeView={visibleView}>
          <div id="active-work" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <p className="text-sm text-white/55">
              Files and checks for this change. Open the optional details only if something looks stuck.
            </p>
            {veraExecutionBlocked ? (
              <Surface padding="md" variant="inset" className="border-amber-500/40 text-amber-100">
                <p className="font-medium">Vera handoff execution is gated</p>
                <p className="mt-2 text-sm">
                  Worker plan execution and Hermes dispatch are disabled for Vera-prepared runs
                  until a future controlled execution phase. Complete the Vera execution approval
                  gate above first; this panel does not execute code.
                </p>
              </Surface>
            ) : data.autonomous ? (
              <Surface padding="md" variant="inset">
                <p className="font-medium text-white">Autonomous mode — worker plan is the mutation substrate</p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Generate/submit worker plan and manual QC retry are not required. The autonomous
                  loop validates and executes worker plans and runs allowlisted QC. Legacy controls
                  remain below for audit only.
                </p>
              </Surface>
            ) : (
              <>
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

                <HermesWorkerPanel runId={runId} />
              </>
            )}

            <EngineeringReviewSignoffPanel runId={runId} />

            <CommitCandidatePanel runId={runId} />

            <Surface
              as="section"
              id={RUN_PANEL_IDS.changedFiles}
              className="scroll-mt-28"
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
            </Surface>

            <Surface
              as="section"
              id={RUN_PANEL_IDS.qualityGates}
              className="scroll-mt-28"
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
                    <Surface key={gate.id} padding="sm" variant="inset">
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
                    </Surface>
                  ))}
                </div>
              )}
            </Surface>
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="review" activeView={visibleView}>
          <div id="governance-review" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <details className="rounded-xl border border-white/8 px-4 py-3">
              <summary className="cursor-pointer text-sm text-white/55">
                <h2 className="inline text-sm font-medium text-white/70">Paper trail (optional)</h2>
              </summary>
              <div className="mt-4 space-y-4">
            <p className="text-sm text-white/55">
              You already decided above. These records stay here if something looks wrong later.
            </p>

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
              <Surface
                as="section"
                id={RUN_PANEL_IDS.approval}
                className="scroll-mt-28"
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
                  <Surface className="mb-3 text-sm" padding="sm" variant="inset">
                    <p className="font-medium">Worker plan: {report.workerPlan.summary}</p>
                    <p className="text-xs text-[var(--muted)]">
                      validation {report.workerPlan.validationStatus} · execution{" "}
                      {report.workerPlan.executionStatus} · {report.workerPlan.executedCount}{" "}
                      operation(s)
                    </p>
                  </Surface>
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
              </Surface>
            ) : null}
              </div>
            </details>
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="pr" activeView={visibleView}>
          <div id={RUN_PANEL_IDS.prCreation} className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <p className="text-sm text-white/55">
              Sharing creates a pull request. Skip Later until the job is approved and you are
              ready to show the change.
            </p>
            <PrCreationPanel runId={runId} />
          </div>
        </RunWorkspaceViewPanel>

        <RunWorkspaceViewPanel viewId="release" activeView={visibleView}>
          <div id="pr-release" className="scroll-mt-28 space-y-4" tabIndex={-1}>
            <p className="text-sm text-white/55">
              Merge, deploy, and sign-off. Leave this closed until the change is already shared
              and you intend to ship.
            </p>
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
            <Surface as="section">
              <h2 className="mb-3 font-semibold">History overview</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">
                This is the paper trail. You do not need it to finish a normal job. Open it if
                something looks wrong and you need to see what already happened.
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Surface padding="sm" variant="inset">
                  <dt className="text-[var(--muted)]">Audit events</dt>
                  <dd className="mt-1 text-white">{data.uxSummary.audit.eventCount}</dd>
                </Surface>
                <Surface padding="sm" variant="inset">
                  <dt className="text-[var(--muted)]">Chain status</dt>
                  <dd className="mt-1 text-white">
                    {data.uxSummary.audit.chainOk ? "verified" : "failed"}
                  </dd>
                </Surface>
                <Surface padding="sm" variant="inset">
                  <dt className="text-[var(--muted)]">Chain failures</dt>
                  <dd className="mt-1 text-white">{data.uxSummary.audit.chainFailureCount}</dd>
                </Surface>
              </dl>
            </Surface>

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
