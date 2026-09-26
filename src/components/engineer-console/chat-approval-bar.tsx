"use client";

import React, { useEffect, useMemo, useState } from "react";
import { governanceModeDirectorCopy, type GovernanceMode } from "@/lib/engineer-console/governance/governance-mode";
import {
  deriveRunApprovalActionCardState,
  deriveRunCommandCenterState,
} from "@/lib/engineer-console/run-ux/derive-run-ux";
import { deriveRunCurrentActionZoneState } from "@/lib/engineer-console/run-ux/run-page-sections";
import { buildRunDecisionBrief, buildRecommendedApprovalRationale, buildRecommendedSendBackRationale } from "@/lib/engineer-console/run-ux/run-decision-brief";
import type { ChatPendingApproval } from "@/lib/engineer-console/dashboard/workflow-map";
import type { ApprovalReport } from "@/lib/engineer-console/types";
import type { RunWorkflowSummary } from "@/lib/engineer-console/run-ux/run-ux-types";
import { ApprovalActions } from "./approval-actions";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { resolveLiveApprovalEligibility } from "@/lib/engineer-console/approval/approval-report";

export function ChatApprovalBar({
  pending,
  onAskVera,
  onHumanDecision,
}: {
  pending: ChatPendingApproval;
  onAskVera?: () => void;
  onHumanDecision?: (action: "approve" | "request_fix" | "stop", rationale: string) => void;
}) {
  const [payload, setPayload] = useState<{
    task: { title: string };
    changedFiles: string[];
    qualityGates: Array<{ command?: string; status?: string }>;
    approvalReport: ApprovalReport | null;
    runStatus: string;
    uxSummary: RunWorkflowSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<"approve" | "request_fix" | "stop" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await engineerConsoleFetch(`/api/engineer-console/runs/${pending.runId}`);
        const body = (await response.json()) as {
          run?: { status?: string };
          task?: { title?: string };
          changedFiles?: string[];
          qualityGates?: Array<{ command?: string; status?: string }>;
          approvalReport?: ApprovalReport | null;
          uxSummary?: RunWorkflowSummary;
        };
        if (!response.ok || !body.uxSummary) {
          throw new Error("Could not load this job");
        }
        if (cancelled) return;
        setPayload({
          task: { title: body.task?.title ?? pending.title },
          changedFiles: body.changedFiles ?? [],
          qualityGates: body.qualityGates ?? [],
          approvalReport: body.approvalReport ?? null,
          runStatus: body.run?.status ?? "waiting_for_approval",
          uxSummary: body.uxSummary,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [pending.runId, pending.title]);

  const decision = useMemo(() => {
    if (!payload) return null;
    const guidance = deriveRunCommandCenterState(payload.uxSummary);
    const approval = deriveRunApprovalActionCardState(payload.uxSummary);
    const currentAction = deriveRunCurrentActionZoneState(payload.uxSummary, guidance);
    const skippedGates = payload.qualityGates.some((gate) => gate.status === "skipped");
    const pendingReview = payload.uxSummary.review.pendingCount > 0;
    const brief = buildRunDecisionBrief({
      taskTitle: payload.task.title,
      happening:
        pendingReview || skippedGates
          ? "The worker finished a change. Automatic tests did not fully run, or policy asked a person to look, so this job is waiting on you."
          : [currentAction.description, approval.currentStateDetail].filter(Boolean).join(" "),
      recommendation:
        payload.approvalReport?.recommendedNextAction?.trim() || approval.nextRequiredAction,
      canApprove: approval.approvalAvailable,
      hardBlocked:
        payload.uxSummary.policy.status === "blocked" || payload.uxSummary.review.rejectedCount > 0,
      changedFiles: payload.changedFiles,
      qualityGates: payload.qualityGates,
      governanceIssues:
        payload.approvalReport?.governanceIssues ?? payload.uxSummary.approval.governanceIssues,
      extraIssues: approval.blockers.map((item) => item.text),
      pendingReviewCount: payload.uxSummary.review.pendingCount,
    });
    return { brief, approval };
  }, [payload]);

  const eligibility = useMemo(() => {
    if (!payload) return null;
    return resolveLiveApprovalEligibility({
      runStatus: payload.runStatus,
      report: payload.approvalReport,
    });
  }, [payload]);

  const modeCopy = useMemo(() => {
    const mode = (payload?.uxSummary.governance?.mode ?? "build") as GovernanceMode;
    return governanceModeDirectorCopy(mode);
  }, [payload?.uxSummary.governance?.mode]);

  const canApprove =
    Boolean(decision) &&
    Boolean(eligibility?.canApprove) &&
    !decision?.brief.blocked &&
    !decision?.brief.gates.some((gate) => gate.status === "failed") &&
    decision?.approval.approvalAvailable !== false;

  return (
    <div
      data-chat-approval-bar="true"
      data-chat-approval-blocked={decision && !canApprove ? "true" : "false"}
      className="mx-4 mb-2 rounded-[1rem] border border-amber-200/20 bg-amber-200/[0.06] p-3"
    >
      {!payload && !error ? (
        <p className="text-[13px] text-white/60" data-chat-approval-checking="true">
          Checking whether Approve is allowed…
        </p>
      ) : null}
      {error ? <p className="text-[12px] text-rose-300/80">{error}</p> : null}
      {recorded ? (
        <p className="text-[13px] text-white/70">
          {recorded === "approve"
            ? "You accepted delivery. That was recorded as your decision, not Vera’s."
            : recorded === "request_fix" && payload?.uxSummary.governance?.continueEngineeringResumesAe
              ? "Continue engineering started. Autonomous Engineer is resuming on this run with your feedback."
              : "You sent this back. That was recorded as your decision, not Vera’s."}
        </p>
      ) : decision ? (
        <div className="space-y-2">
          <p className="text-[12px] uppercase tracking-wide text-amber-100/70">
            Your decision · {modeCopy.zoneLabel}
          </p>
          <p className="text-[13px] text-white/60">
            These buttons are yours. They are not sent through Vera.
          </p>
          <p className="text-sm text-white">{decision.brief.title}</p>
          <p className="text-[13px] text-white/75">{decision.brief.happening}</p>
          <p className="text-[13px] text-white/80">{decision.brief.recommendation}</p>
          <p className="text-[13px] text-white/60">{modeCopy.continueHint}</p>
          {decision.brief.files.length > 0 || decision.brief.gates.length > 0 || decision.brief.checks.length > 0 ? (
            <details className="text-[13px] text-white/60">
              <summary className="cursor-pointer text-white/60">Files and checks</summary>
              <div className="mt-2 space-y-2">
                {decision.brief.files.length > 0 ? (
                  <ul className="max-h-20 overflow-auto font-mono text-[11px] text-white/65">
                    {decision.brief.files.map((file) => (
                      <li key={file} className="truncate">
                        {file}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {decision.brief.gates.map((gate) => (
                  <p key={`${gate.label}-${gate.status}`}>
                    {gate.label}: {gate.status}
                    {gate.status === "skipped" ? " — no automatic test ran" : ""}
                  </p>
                ))}
                {decision.brief.checks.map((check) => (
                  <p key={check.id}>
                    {check.title}: {check.why}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          {eligibility && !eligibility.canApprove ? (
            <p className="text-[13px] text-rose-300/85" data-chat-approval-blocked-reason="true">
              Approve is blocked: {eligibility.details[0] ?? eligibility.summary}
            </p>
          ) : null}
          <ApprovalActions
            runId={pending.runId}
            canApprove={canApprove}
            approvalRequiresRationale={
              decision.approval.rationale.approve === "required" ||
              decision.brief.checks.length > 0 ||
              decision.brief.gates.some((gate) => gate.status === "skipped")
            }
            recommendedRationale={buildRecommendedApprovalRationale(decision.brief)}
            recommendedSendBackRationale={buildRecommendedSendBackRationale(decision.brief)}
            showApprove={decision.approval.showApprove || decision.brief.checks.length > 0}
            showRequestFix={decision.approval.showRequestFix}
            showStop={false}
            refreshOnSuccess={false}
            onRecorded={(action, rationale) => {
              setRecorded(action);
              onHumanDecision?.(action, rationale);
            }}
            onError={setError}
            approveLabel={modeCopy.approveLabel}
            denyLabel={modeCopy.continueLabel}
            rationaleHint={`${modeCopy.approveHint} ${modeCopy.continueHint}`}
          />
          {onAskVera ? (
            <button
              type="button"
              data-chat-ask-vera-recover="true"
              onClick={onAskVera}
              className="text-[12px] text-white/55 underline-offset-2 hover:text-white hover:underline"
            >
              Ask Vera to recover
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
