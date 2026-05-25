"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import {
  buildReleaseGateChecklistItems,
  describeReleaseGateStatus,
} from "@/lib/engineer-console/run-ux/release-gate-ux";

type HardReleaseGateAction =
  | "merge"
  | "deployment_execution"
  | "deployment_approval_approve"
  | "release_signoff_completed"
  | "release_signoff_completed_with_exceptions";

interface GateEvaluation {
  enabled: boolean;
  action: string;
  status: string;
  blockers: string[];
  blockerCount: number;
  recommendedAction: string | null;
  signals: {
    checklistStatus: string | null;
    signoffDecision: string | null;
    healthPolicyStatus: string | null;
    policyStatus: string | null;
    replayStatus: string | null;
  };
}

function toneClasses(tone: "muted" | "ready" | "warning" | "blocked"): string {
  switch (tone) {
    case "ready":
      return "border-emerald-500/40 bg-emerald-950/20";
    case "warning":
      return "border-amber-500/40 bg-amber-950/20";
    case "blocked":
      return "border-red-500/40 bg-red-950/20";
    default:
      return "border-[var(--border)] bg-[var(--background)]";
  }
}

export function HardReleaseGateBannerContent({
  config,
  evaluation,
}: {
  config: { hardGatesEnabled: boolean };
  evaluation: GateEvaluation;
}) {
  const status = describeReleaseGateStatus({
    enabled: config.hardGatesEnabled,
    status: evaluation.status,
    blockers: evaluation.blockers,
    signals: evaluation.signals,
  });
  const checklistItems = buildReleaseGateChecklistItems(evaluation.blockers);

  if (!config.hardGatesEnabled) {
    return (
      <div className={`mb-3 rounded border p-3 text-sm ${toneClasses(status.tone)}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Hard release gates</span>
          <span className="rounded border border-current px-2 py-0.5 text-[11px] font-medium">
            {status.label}
          </span>
        </div>
        <p className="mt-1 text-[var(--muted)]">{status.detail}</p>
      </div>
    );
  }

  return (
    <div className={`mb-3 rounded border p-3 text-sm ${toneClasses(status.tone)}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">Hard release gates</span>
        <span className="rounded border border-current px-2 py-0.5 text-[11px] font-medium">
          {status.label}
        </span>
      </div>

      <p className="mb-3 text-[var(--muted)]">{status.detail}</p>

      {checklistItems.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-2 text-sm font-medium">Action checklist</h3>
          <ol className="space-y-2">
            {checklistItems.map((item) => (
              <li
                key={item.id}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-3"
              >
                <p className="font-medium">{item.label}</p>
                <p className="mt-1 text-[var(--muted)]">{item.whyItMatters}</p>
                <a
                  href={item.href}
                  className="mt-2 inline-flex text-sm text-[var(--accent)] underline underline-offset-2"
                >
                  {item.ctaLabel}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      {evaluation.recommendedAction && (
        <p className="text-[var(--muted)]">{evaluation.recommendedAction}</p>
      )}

      <details className="mt-3 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">Technical details</summary>
        <div className="mt-2 space-y-2">
          {evaluation.blockers.length > 0 && (
            <ul className="list-inside list-disc">
              {evaluation.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <p>
            checklist {evaluation.signals.checklistStatus ?? "—"} · sign-off{" "}
            {evaluation.signals.signoffDecision ?? "—"} · health policy{" "}
            {evaluation.signals.healthPolicyStatus ?? "—"} · policy{" "}
            {evaluation.signals.policyStatus ?? "—"} · replay {evaluation.signals.replayStatus ?? "—"}
          </p>
        </div>
      </details>
    </div>
  );
}

export function HardReleaseGateBanner({
  runId,
  action,
}: {
  runId: string;
  action: HardReleaseGateAction;
}) {
  const [config, setConfig] = useState<{ hardGatesEnabled: boolean } | null>(null);
  const [evaluation, setEvaluation] = useState<GateEvaluation | null>(null);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/release-gates`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      config: { hardGatesEnabled: boolean };
      evaluations: Record<string, GateEvaluation>;
    };
    setConfig(data.config);
    setEvaluation(data.evaluations[action] ?? null);
  }, [runId, action]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!config?.hardGatesEnabled || !evaluation) {
    return evaluation ? (
      <HardReleaseGateBannerContent config={config ?? { hardGatesEnabled: false }} evaluation={evaluation} />
    ) : (
      <div className="mb-3 rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Hard release gates</span>
          <span className="rounded border border-current px-2 py-0.5 text-[11px] font-medium">
            Release gates disabled
          </span>
        </div>
        <p className="mt-1 text-[var(--muted)]">
          Checklist and sign-off remain advisory in this mode.
        </p>
      </div>
    );
  }

  return <HardReleaseGateBannerContent config={config} evaluation={evaluation} />;
}
