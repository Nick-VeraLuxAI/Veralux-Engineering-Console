"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";

export function ApprovalActions({
  runId,
  canApprove,
  approvalRequiresRationale = false,
  showApprove = true,
  showRequestFix = true,
  showStop = true,
  rationaleGuidance = [],
  recommendedRationale = "",
  recommendedSendBackRationale = "",
  approveLabel = "Approve run",
  denyLabel = "Request Fix",
  stopLabel = "Stop Run",
  rationaleHint,
  refreshOnSuccess = true,
  onRecorded,
  onError,
}: {
  runId: string;
  canApprove: boolean;
  approvalRequiresRationale?: boolean;
  showApprove?: boolean;
  showRequestFix?: boolean;
  showStop?: boolean;
  rationaleGuidance?: string[];
  recommendedRationale?: string;
  recommendedSendBackRationale?: string;
  approveLabel?: string;
  denyLabel?: string;
  stopLabel?: string;
  rationaleHint?: string;
  refreshOnSuccess?: boolean;
  onRecorded?: (action: "approve" | "request_fix" | "stop", rationale: string) => void;
  onError?: (message: string | null) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [rationaleTouched, setRationaleTouched] = useState(false);

  useEffect(() => {
    if (rationaleTouched || !recommendedRationale.trim()) return;
    setRationale(recommendedRationale);
  }, [recommendedRationale, rationaleTouched]);

  async function sendAction(action: "approve" | "request_fix" | "stop") {
    if (action === "approve" && approvalRequiresRationale && !rationale.trim()) {
      setError("Write a short reason before approving, so the checks are recorded with your decision.");
      return;
    }

    if ((action === "request_fix" || action === "stop") && !rationale.trim()) {
      setError(
        action === "request_fix"
          ? "Rationale is required for Request Fix."
          : "Rationale is required for Stop Run.",
      );
      return;
    }

    setLoading(action);
    setError(null);
    onError?.(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          rationale: rationale.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Action failed");
      }
      const note = rationale.trim();
      setRationale("");
      onRecorded?.(action, note);
      if (refreshOnSuccess) {
        router.refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {rationaleGuidance.length > 0 && (
        <ul className="list-inside list-disc text-sm text-[var(--muted)]">
          {rationaleGuidance.map((guidance) => (
            <li key={guidance}>{guidance}</li>
          ))}
        </ul>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">
          {rationaleHint ??
            (approvalRequiresRationale
              ? "Suggested reason (edit if you want, then approve)"
              : "Suggested reason (edit if you want)")}
        </span>
        <textarea
          value={rationale}
          onChange={(e) => {
            setRationaleTouched(true);
            setRationale(e.target.value);
          }}
          rows={3}
          data-approval-rationale="true"
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          placeholder="Why are you accepting this, sending it back, or stopping?"
        />
        {(recommendedRationale.trim() || recommendedSendBackRationale.trim()) ? (
          <p className="text-xs text-[var(--muted)]">
            {recommendedRationale.trim() ? (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setRationaleTouched(false);
                  setRationale(recommendedRationale);
                }}
              >
                Use approval suggestion
              </button>
            ) : null}
            {recommendedRationale.trim() && recommendedSendBackRationale.trim() ? " · " : null}
            {recommendedSendBackRationale.trim() ? (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setRationaleTouched(true);
                  setRationale(recommendedSendBackRationale);
                }}
              >
                Use send-back suggestion
              </button>
            ) : null}
          </p>
        ) : null}
      </label>
      <div className="flex flex-wrap gap-2">
        {showApprove && (
          <Button
            type="button"
            disabled={!canApprove || loading !== null}
            onClick={() => sendAction("approve")}
            variant="primary"
            className="bg-[var(--success)] text-[var(--success-foreground)] shadow-[0_18px_40px_rgba(34,197,94,0.2)] hover:bg-[var(--success)]/90"
          >
            {loading === "approve" ? "Approving..." : approveLabel}
          </Button>
        )}
        {showRequestFix && (
          <Button
            type="button"
            disabled={loading !== null}
            onClick={() => void sendAction("request_fix")}
            variant="secondary"
            className="border-amber-500/30 bg-amber-500/14 text-[var(--warning-foreground)] shadow-[0_18px_40px_rgba(217,119,6,0.14)] hover:bg-amber-500/22"
          >
            {loading === "request_fix" ? "Sending..." : denyLabel}
          </Button>
        )}
        {showStop && (
          <Button
            type="button"
            disabled={loading !== null}
            onClick={() => void sendAction("stop")}
            variant="danger"
          >
            {loading === "stop" ? "Stopping..." : stopLabel}
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        This only records your decision. It does not merge, commit, or deploy.
      </p>
    </div>
  );
}
