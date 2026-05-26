"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
}: {
  runId: string;
  canApprove: boolean;
  approvalRequiresRationale?: boolean;
  showApprove?: boolean;
  showRequestFix?: boolean;
  showStop?: boolean;
  rationaleGuidance?: string[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");

  async function sendAction(action: "approve" | "request_fix" | "stop") {
    if (action === "approve" && approvalRequiresRationale && !rationale.trim()) {
      setError("Rationale is required before approval because policy status is requires_review.");
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
      setRationale("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
          Rationale{" "}
          {approvalRequiresRationale
            ? "(required for Approve, Request Fix, and Stop Run in this state)"
            : "(optional for Approve; required for Request Fix and Stop Run)"}
        </span>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          placeholder="Describe why you are approving, requesting a fix, or stopping..."
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {showApprove && (
          <Button
            disabled={!canApprove || loading !== null}
            onClick={() => sendAction("approve")}
            variant="primary"
            className="bg-[var(--success)] text-[var(--success-foreground)] shadow-[0_18px_40px_rgba(34,197,94,0.2)] hover:bg-[var(--success)]/90"
          >
            {loading === "approve" ? "Approving..." : "Approve run"}
          </Button>
        )}
        {showRequestFix && (
          <Button
            disabled={loading !== null}
            onClick={() => void sendAction("request_fix")}
            variant="secondary"
            className="border-amber-500/30 bg-amber-500/14 text-[var(--warning-foreground)] shadow-[0_18px_40px_rgba(217,119,6,0.14)] hover:bg-amber-500/22"
          >
            {loading === "request_fix" ? "Sending..." : "Request Fix"}
          </Button>
        )}
        {showStop && (
          <Button
            disabled={loading !== null}
            onClick={() => void sendAction("stop")}
            variant="danger"
          >
            {loading === "stop" ? "Stopping..." : "Stop Run"}
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Actions update workflow state only — no merge, commit, or deploy. Each action creates an
        auditable decision record.
      </p>
    </div>
  );
}
