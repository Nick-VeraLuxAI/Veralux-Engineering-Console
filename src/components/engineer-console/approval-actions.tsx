"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

export function ApprovalActions({
  runId,
  canApprove,
}: {
  runId: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [showRationale, setShowRationale] = useState(false);

  async function sendAction(action: "approve" | "request_fix" | "stop") {
    if ((action === "request_fix" || action === "stop") && !rationale.trim()) {
      setShowRationale(true);
      setError("Rationale is required for request fix and stop.");
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
      setShowRationale(false);
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
      {(showRationale || rationale) && (
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">
            Rationale (required for Request Fix / Stop; optional for Approve)
          </span>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
            placeholder="Describe why you are approving, requesting a fix, or stopping…"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canApprove || loading !== null}
          onClick={() => sendAction("approve")}
          className="rounded bg-[var(--success)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => {
            setShowRationale(true);
            void sendAction("request_fix");
          }}
          className="rounded bg-[var(--warning)] px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {loading === "request_fix" ? "Sending…" : "Request Fix"}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => {
            setShowRationale(true);
            void sendAction("stop");
          }}
          className="rounded bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading === "stop" ? "Stopping…" : "Stop"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Actions update workflow state only — no merge, commit, or deploy. Each action creates an
        auditable decision record.
      </p>
    </div>
  );
}
