"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import {
  deriveRunCommandCenterState,
  deriveRunApprovalActionCardState,
  deriveRunLifecycleSteps,
} from "@/lib/engineer-console/run-ux/derive-run-ux";
import {
  RUN_PANEL_IDS,
  type RunSectionGroupId,
  type RunWorkflowSummary,
} from "@/lib/engineer-console/run-ux/run-ux-types";
import {
  deriveRunCurrentActionZoneState,
  deriveRunSectionGroups,
} from "@/lib/engineer-console/run-ux/run-page-sections";
import {
  RUN_GROUP_ANCHOR_IDS,
  RUN_NAV_TARGET_IDS,
  buildRunExpertSummaryItems,
  buildRunQuickNavItems,
  expandGroupForTarget,
  resolveRunNavigationShortcut,
} from "@/lib/engineer-console/run-ux/run-navigation";
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
import { RunSectionGroup } from "./run-section-group";
import { RunCurrentActionZone } from "./run-current-action-zone";
import { RunQuickNav } from "./run-quick-nav";
import { RunExpertSummary } from "./run-expert-summary";
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

function buildExpandedGroupState(
  groups: Array<{ id: RunSectionGroupId; defaultExpanded: boolean }>,
): Record<RunSectionGroupId, boolean> {
  return groups.reduce<Record<RunSectionGroupId, boolean>>(
    (acc, group) => {
      acc[group.id] = group.defaultExpanded;
      return acc;
    },
    {
      active_work: false,
      governance_review: false,
      pr_release: false,
      technical_audit: false,
    },
  );
}

function mergeExpandedGroupState(
  current: Record<RunSectionGroupId, boolean>,
  groups: Array<{ id: RunSectionGroupId; defaultExpanded: boolean }>,
): Record<RunSectionGroupId, boolean> {
  const next = { ...current };
  for (const group of groups) {
    next[group.id] = current[group.id] || group.defaultExpanded;
  }
  return next;
}

export function RunLivePanel({ runId, initial }: { runId: string; initial: RunDetailPayload }) {
  const [data, setData] = useState(initial);
  const [incomingPlanJson, setIncomingPlanJson] = useState<string | undefined>(undefined);
  const [pendingShortcutPrefix, setPendingShortcutPrefix] = useState<string | null>(null);
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
  const currentAction = deriveRunCurrentActionZoneState(data.uxSummary, guidance);
  const sectionGroups = deriveRunSectionGroups(data.uxSummary, guidance);
  const [expandedGroups, setExpandedGroups] = useState<Record<RunSectionGroupId, boolean>>(() =>
    buildExpandedGroupState(sectionGroups),
  );
  const quickNavItems = buildRunQuickNavItems(data.uxSummary, guidance);
  const expertSummaryItems = buildRunExpertSummaryItems(data.uxSummary, guidance);
  const activeWorkGroup = sectionGroups.find((group) => group.id === "active_work")!;
  const governanceGroup = sectionGroups.find((group) => group.id === "governance_review")!;
  const releaseGroup = sectionGroups.find((group) => group.id === "pr_release")!;
  const technicalAuditGroup = sectionGroups.find((group) => group.id === "technical_audit")!;

  useEffect(() => {
    setExpandedGroups((current) => mergeExpandedGroupState(current, sectionGroups));
  }, [sectionGroups]);

  const navigateToTarget = useCallback((targetId: string) => {
    setExpandedGroups((current) => expandGroupForTarget(current, targetId));

    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;

      const details = target instanceof HTMLDetailsElement ? target : target.closest("details");
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
      }

      window.history.pushState(null, "", `#${targetId}`);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  useEffect(() => {
    function applyHashNavigation(targetId: string) {
      if (!targetId) return;
      setExpandedGroups((current) => expandGroupForTarget(current, targetId));
      window.requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        const details = target instanceof HTMLDetailsElement ? target : target.closest("details");
        if (details instanceof HTMLDetailsElement) {
          details.open = true;
        }
      });
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
      navigateToTarget(result.targetId);
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
      navigateToTarget(decodeURIComponent(href.slice(1)));
    },
    [navigateToTarget],
  );

  return (
    <div className="space-y-6" onClickCapture={handleAnchorNavigation}>
      <RunCommandCenter summary={data.uxSummary} guidance={guidance} />

      <RunLifecycleStepper
        steps={lifecycleSteps}
        currentStageId={guidance.currentStageId}
      />

      <RunQuickNav items={quickNavItems} />

      <RunExpertSummary items={expertSummaryItems} />

      <div id={RUN_NAV_TARGET_IDS.currentAction} className="scroll-mt-24">
        <RunCurrentActionZone state={currentAction} />
      </div>

      <section
        id={RUN_PANEL_IDS.runState}
        className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="mb-3 font-semibold">Run state</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          What this is: the recorded run status, branch, and risk summary. Why it matters: it
          confirms the base context for every later panel. What to do next: use the Current Action
          area above, then return here if the run status or branch looks unexpected.
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

      <RunSectionGroup
        state={activeWorkGroup}
        anchorId={RUN_GROUP_ANCHOR_IDS.active_work}
        expanded={expandedGroups.active_work}
        onToggle={(nextExpanded) =>
          setExpandedGroups((current) => ({ ...current, active_work: nextExpanded }))
        }
      >
        <RunApprovalActionCard runId={runId} state={approvalCardState} />

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
          <p className="mb-3 text-sm text-[var(--muted)]">
            What this is: the file-level change list for the current run. Why it matters: it lets
            the operator confirm scope before approval, PR creation, or release work. What to do
            next: check that only expected files are present.
          </p>
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Quality gates</h2>
            <OperatorHelp term="quality_gates" label="What are quality gates?" />
          </div>
          <p className="mb-3 text-sm text-[var(--muted)]">
            What this is: recorded gate results for build, test, lint, and related checks. Why it
            matters: failed gates block later release work. What to do next: review failures or
            confirm the run is ready to move forward.
          </p>
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
      </RunSectionGroup>

      <RunSectionGroup
        state={governanceGroup}
        anchorId={RUN_GROUP_ANCHOR_IDS.governance_review}
        expanded={expandedGroups.governance_review}
        onToggle={(nextExpanded) =>
          setExpandedGroups((current) => ({ ...current, governance_review: nextExpanded }))
        }
      >
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
        {report && (
          <section
            id={RUN_PANEL_IDS.approval}
            className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Approval report</h2>
              <OperatorHelp term="approval_report" label="What is the approval report?" />
            </div>
            <p className="mb-2 text-sm text-[var(--muted)]">
              What this is: the detailed approval report for the run. Why it matters: it preserves
              the same auditable approval data and controls used by the approval action card. What
              to do next: review the report details, then record the human decision if the run is
              ready.
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
      </RunSectionGroup>

      <RunSectionGroup
        state={releaseGroup}
        anchorId={RUN_GROUP_ANCHOR_IDS.pr_release}
        expanded={expandedGroups.pr_release}
        onToggle={(nextExpanded) =>
          setExpandedGroups((current) => ({ ...current, pr_release: nextExpanded }))
        }
      >
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
      </RunSectionGroup>

      <RunSectionGroup
        state={technicalAuditGroup}
        anchorId={RUN_GROUP_ANCHOR_IDS.technical_audit}
        expanded={expandedGroups.technical_audit}
        onToggle={(nextExpanded) =>
          setExpandedGroups((current) => ({ ...current, technical_audit: nextExpanded }))
        }
      >
        <div
          id={RUN_PANEL_IDS.auditTimeline}
          className="scroll-mt-24"
        >
          <AuditTimelinePanel runId={runId} />
        </div>
      </RunSectionGroup>
    </div>
  );
}
