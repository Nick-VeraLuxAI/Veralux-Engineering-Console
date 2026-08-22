"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { SENIOR_REVIEW_REQUEST_CONFIRMATION } from "@/lib/engineer-console/senior-escalation/queue-types";
import type { SeniorReviewPanelView } from "@/lib/engineer-console/senior-escalation/panel-view";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { StatusBadge } from "./status-badge";

export function buildSeniorReviewRequestBody(confirmationText: string): { confirmationText: string } {
  return { confirmationText };
}

export function isSeniorReviewRequestEnabled(
  view: SeniorReviewPanelView | null,
  confirmationText: string,
): boolean {
  if (!view) return false;
  return view.canRequest && confirmationText === SENIOR_REVIEW_REQUEST_CONFIRMATION;
}

export function SeniorReviewPanel({
  runId,
  initialView = null,
}: {
  runId: string;
  initialView?: SeniorReviewPanelView | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<SeniorReviewPanelView | null>(initialView);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialView) return;
    let cancelled = false;
    void engineerConsoleFetch(`/api/engineer-console/runs/${runId}/senior-review`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { view?: SeniorReviewPanelView };
        if (!cancelled && data.view) setView(data.view);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId, initialView]);

  async function requestReview() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/senior-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSeniorReviewRequestBody(confirmation)),
      });
      const data = (await res.json()) as { view?: SeniorReviewPanelView; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Senior review request failed");
      if (data.view) setView(data.view);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senior review request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;

  const enabled = isSeniorReviewRequestEnabled(view, confirmation);

  return (
    <Surface as="section" id="senior-review-panel" className="mb-6 scroll-mt-28" data-testid="senior-review-panel">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Senior Review</h2>
        <StatusBadge status={view.status} />
        <span className="text-xs text-[var(--muted)]">{view.statusLabel}</span>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Advisory only. DeepSeek is on-demand and is not the AE worker. Human approval gates remain
        required. This panel does not start models or authorize PR, merge, or deploy.
      </p>
      <dl className="mb-4 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Availability</dt>
          <dd className="text-white" data-testid="senior-review-availability">{view.seniorAvailability}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Recommended profile</dt>
          <dd className="text-white">deepseek-senior (on demand)</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Objective</dt>
          <dd className="text-white">{view.objective ?? "Not available"}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Escalation reasons</dt>
          <dd className="text-white" data-testid="senior-review-reasons">
            {view.escalationReasons.join(", ") || "None"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Blocked reasons</dt>
          <dd className="text-white" data-testid="senior-review-blocked">
            {view.blockedReasonLabels.join(" ") || "None"}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Human gates</dt>
          <dd className="text-white">{view.nextHumanGate}</dd>
        </div>
      </dl>

      {view.parsedReview ? (
        <Surface className="mb-4" padding="sm" variant="inset" data-testid="senior-review-advisory">
          <p className="font-medium text-white">Advisory senior judgment</p>
          <p className="mt-2 text-sm text-white">{view.parsedReview.rootCause}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{view.parsedReview.nextWorkerMission}</p>
        </Surface>
      ) : null}

      {view.rawResponsePreview && !view.parsedReview ? (
        <p className="mb-4 text-sm text-[var(--muted)]" data-testid="senior-review-raw">
          {view.rawResponsePreview}
        </p>
      ) : null}

      <label className="block text-sm text-[var(--muted)]">
        Type {SENIOR_REVIEW_REQUEST_CONFIRMATION} to request senior review
        <input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm"
          placeholder={SENIOR_REVIEW_REQUEST_CONFIRMATION}
          autoComplete="off"
        />
      </label>
      <Button
        className="mt-3"
        disabled={busy || !enabled}
        onClick={() => void requestReview()}
        data-testid="senior-review-request"
      >
        {busy ? "Requesting…" : "Request Senior Review"}
      </Button>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </Surface>
  );
}
