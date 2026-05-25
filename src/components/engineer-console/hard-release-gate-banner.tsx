"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

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
    return (
      <p className="mb-3 text-xs text-[var(--muted)]">
        Hard release gates: disabled (advisory checklist/sign-off only).
      </p>
    );
  }

  return (
    <div className="mb-3 rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">Hard release gates</span>
        <StatusBadge status="enabled" />
        <StatusBadge status={evaluation.status} />
      </div>
      {evaluation.blockers.length > 0 && (
        <ul className="mb-2 list-inside list-disc text-[var(--danger)]">
          {evaluation.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {evaluation.recommendedAction && (
        <p className="text-[var(--muted)]">{evaluation.recommendedAction}</p>
      )}
      <p className="mt-2 font-mono text-xs text-[var(--muted)]">
        checklist {evaluation.signals.checklistStatus ?? "—"} · sign-off{" "}
        {evaluation.signals.signoffDecision ?? "—"} · health policy{" "}
        {evaluation.signals.healthPolicyStatus ?? "—"}
      </p>
    </div>
  );
}
