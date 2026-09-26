"use client";

import React, { useEffect, useState } from "react";
import { ApprovalActions } from "./approval-actions";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import type { RunApprovalActionCardState } from "@/lib/engineer-console/run-ux/run-ux-types";
import {
  operatorReviewStageCopy,
  buildRecommendedApprovalRationale,
  buildRecommendedSendBackRationale,
  type RunDecisionBrief,
  type RunDecisionCheck,
} from "@/lib/engineer-console/run-ux/run-decision-brief";

export function RunDecisionPanel({
  runId,
  brief,
  approval,
  compact = false,
}: {
  runId: string;
  brief: RunDecisionBrief;
  approval: RunApprovalActionCardState;
  compact?: boolean;
}) {
  const [checks, setChecks] = useState<RunDecisionCheck[]>(brief.checks);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const generated = await engineerConsoleFetch(
          `/api/engineer-console/runs/${runId}/review-stages/generate`,
          { method: "POST" },
        );
        const listResponse = generated.ok
          ? generated
          : await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-stages`);
        const body = (await listResponse.json()) as {
          stages?: Array<{
            id: string;
            stage: string;
            status: string;
            required: boolean;
            reason: string | null;
          }>;
        };
        if (cancelled) return;
        const required = (body.stages ?? []).filter((stage) => stage.required);
        setRejected(required.some((stage) => stage.status === "rejected"));
        setChecks(
          required
            .filter((stage) => stage.status === "pending")
            .map((stage) => {
              const copy = operatorReviewStageCopy(stage.stage, stage.reason);
              return {
                id: stage.id,
                title: copy.title,
                why: copy.why,
                status: "pending",
              };
            }),
        );
      } catch {
        if (!cancelled) setChecks(brief.checks);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [brief.checks, runId]);

  const failedGates = brief.gates.some((gate) => gate.status === "failed");
  const skippedGates = brief.gates.some((gate) => gate.status === "skipped");
  const canApprove =
    !rejected &&
    !brief.blocked &&
    !failedGates &&
    (approval.approvalAvailable || checks.length > 0);
  const rationaleRequired =
    approval.rationale.approve === "required" || checks.length > 0 || skippedGates;

  return (
    <div
      data-run-decision-panel="true"
      className={
        compact
          ? "space-y-3"
          : "rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-5"
      }
    >
      <div>
        <p className="text-[12px] uppercase tracking-wide text-white/60">Your decision</p>
        <h2 id="run-decision-heading" className="mt-1 text-lg font-semibold text-white">
          {brief.title}
        </h2>
      </div>

      <section className="space-y-1">
        <h3 className="text-[13px] font-medium text-white/60">What is happening</h3>
        <p className="text-sm text-white/80">{brief.happening}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-white/60">Evidence</h3>
        {brief.files.length > 0 ? (
          <ul className="max-h-24 overflow-auto text-[13px] text-white/70">
            {brief.files.map((file) => (
              <li key={file} className="truncate font-mono">
                {file}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-white/55">No file list yet.</p>
        )}
        {brief.gates.length > 0 ? (
          <ul className="space-y-1 text-sm text-white/75">
            {brief.gates.map((gate) => (
              <li key={`${gate.label}-${gate.status}`}>
                {gate.label}: {gate.status}
                {gate.status === "skipped" ? " — no automatic test ran" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-white/55">No automatic checks recorded yet.</p>
        )}
      </section>

      {checks.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[13px] font-medium text-white/60">What you are confirming</h3>
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <p className="text-sm text-white">{check.title}</p>
                <p className="mt-0.5 text-[13px] text-white/60">{check.why}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.issues.length > 0 ? (
        <ul className="list-inside list-disc text-sm text-amber-200/90">
          {brief.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {rejected ? (
        <p className="text-sm text-rose-300">
          A required check was already rejected. Send this back or stop — do not approve.
        </p>
      ) : null}

      <section className="space-y-1 rounded-xl border border-white/8 bg-white/[0.03] p-3">
        <h3 className="text-[13px] font-medium text-white/60">Recommendation</h3>
        <p className="text-sm text-white">{brief.recommendation}</p>
        <p className="text-[13px] text-white/60">
          Approve accepts this change. Send back asks for a correction. Neither merges or deploys.
        </p>
      </section>

      {(approval.showApprove || approval.showRequestFix || approval.showStop || checks.length > 0) ? (
        <ApprovalActions
          runId={runId}
          canApprove={canApprove}
          approvalRequiresRationale={rationaleRequired}
          recommendedRationale={buildRecommendedApprovalRationale({ ...brief, checks })}
          recommendedSendBackRationale={buildRecommendedSendBackRationale({ ...brief, checks })}
          showApprove={approval.showApprove || checks.length > 0}
          showRequestFix={approval.showRequestFix}
          showStop={approval.showStop}
          rationaleGuidance={[]}
          approveLabel="Approve"
          denyLabel="Send back"
          stopLabel="Stop"
          rationaleHint="Suggested reason from Vera. Edit if you want, then choose Approve or Send back."
        />
      ) : (
        <p className="text-sm text-white/55">{approval.nextRequiredAction}</p>
      )}
    </div>
  );
}

export function RunDecisionDialog({
  open,
  runId,
  brief,
  approval,
}: {
  open: boolean;
  onClose?: () => void;
  runId: string;
  brief: RunDecisionBrief;
  approval: RunApprovalActionCardState;
}) {
  if (!open) return null;
  return <RunDecisionPanel runId={runId} brief={brief} approval={approval} />;
}
