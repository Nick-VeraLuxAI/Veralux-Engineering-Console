"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

import { useCallback, useEffect, useState } from "react";
import type { RunWorkflowSummary } from "@/lib/engineer-console/run-ux/run-ux-types";
import { OperatorHelp } from "./operator-help";
import { StatusBadge } from "./status-badge";

interface ReviewStage {
  id: string;
  stage: string;
  status: string;
  required: boolean;
  reason: string | null;
  reviewerActorLabel: string | null;
  reviewerNotes: string | null;
  evidenceBundleHashPrefix: string | null;
  policyResultId: string | null;
  policyVersion: string | null;
  completedAt: string | null;
}

interface ReviewStageSummary {
  requiredCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  skippedCount: number;
}

function formatStageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}

function actorGuidance(stage: ReviewStage): string {
  if (stage.status !== "pending") {
    return stage.reviewerActorLabel
      ? `Completed by ${stage.reviewerActorLabel}.`
      : "Completed review stage.";
  }

  if (stage.required) {
    return "Admin approval is required to complete this stage. Operator or admin can reject with rationale.";
  }

  return "Admin can approve this optional stage. Operator or admin can reject, and optional stages can be skipped with rationale.";
}

export function ReviewStagesPanel({
  runId,
  workflowSummary,
  initialStages,
  initialSummary,
}: {
  runId: string;
  workflowSummary?: RunWorkflowSummary;
  initialStages?: ReviewStage[];
  initialSummary?: ReviewStageSummary | null;
}) {
  const [stages, setStages] = useState<ReviewStage[]>(initialStages ?? []);
  const [summary, setSummary] = useState<ReviewStageSummary | null>(initialSummary ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialStages === undefined || initialSummary === undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [actorLabel, setActorLabel] = useState("operator");

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-stages`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { stages: ReviewStage[]; summary: ReviewStageSummary };
    setStages(data.stages);
    setSummary(data.summary);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function generateStages() {
    setBusy("generate");
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-stages/generate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stage generation failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAction(stageId: string, action: "approve" | "reject" | "skip") {
    if ((action === "reject" || action === "skip") && !rationale.trim()) {
      setError("Rationale is required for reject and skip actions.");
      return;
    }

    setBusy(`${action}-${stageId}`);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/review-stages/${stageId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, rationale, actorLabel }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stage action failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const blocksApproval =
    summary !== null &&
    (summary.pendingCount > 0 || summary.rejectedCount > 0);
  const policyRequiresReview = workflowSummary?.policy.status === "requires_review";

  return (
    <Surface as="section">
      <SectionHeader
        title="Review stages"
        description="Generate and complete required review checkpoints without changing approval or release authority."
        meta={<OperatorHelp term="review_stages" label="What are review stages?" />}
        actions={
          <Button
            disabled={busy !== null}
            onClick={() => void generateStages()}
            size="sm"
            variant="secondary"
          >
            {busy === "generate" ? "Generating…" : "Generate or refresh stages"}
          </Button>
        }
      />

      {blocksApproval && (
        <Surface className="mt-4 text-sm text-amber-100" padding="sm" variant="warning">
          <p>
            Complete required review stages before final run approval.
            {summary!.rejectedCount > 0 && " One or more required stages were rejected."}
          </p>
        </Surface>
      )}

      {policyRequiresReview && (
        <Surface className="mt-4 text-sm text-amber-100" padding="sm" variant="warning">
          <p>
            Senior review is required before approval. Generate or complete the required review
            stages here, then return to the approval section.
          </p>
        </Surface>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-4 text-sm text-[var(--muted)]">Loading review stages…</p>}

      {!loading && stages.length === 0 && (
        <div className="mt-4">
          <EmptyState
            compact
            title="No review stages yet"
            description="Evaluate policy first, then generate stages when senior review is required."
          />
        </div>
      )}

      {summary && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Required", value: summary.requiredCount },
            { label: "Pending", value: summary.pendingCount },
            { label: "Approved", value: summary.approvedCount },
            { label: "Rejected", value: summary.rejectedCount },
            { label: "Skipped", value: summary.skippedCount },
          ].map((item) => (
            <Surface key={item.label} padding="sm" variant="inset">
              <p className="text-sm text-[var(--muted)]">{item.label}</p>
              <p className="mt-1 font-medium text-white">{item.value}</p>
            </Surface>
          ))}
        </div>
      )}

      <Surface className="mt-4 text-sm text-[var(--muted)]" padding="sm" variant="inset">
        <p className="font-medium text-white">How this affects approval</p>
        <p className="mt-1">
          Required review stages explain why senior review is needed. Once all required stages are
          approved, final run approval becomes available in the approval section.
        </p>
      </Surface>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">
          Actor label
          <input
            value={actorLabel}
            onChange={(e) => setActorLabel(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-[var(--muted)] sm:col-span-2">
          Rationale (required for reject / skip)
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {stages.map((stage) => (
          <Surface key={stage.id} padding="sm" variant="inset">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium capitalize">{formatStageLabel(stage.stage)}</span>
              <StatusBadge status={stage.status} />
              <Badge size="sm" variant={stage.required ? "warning" : "muted"}>
                {stage.required ? "required" : "optional"}
              </Badge>
            </div>
            {stage.reason && (
              <p className="mt-3 text-[var(--muted)]">
                <span className="font-medium text-white">Why review is required:</span> {stage.reason}
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--muted)]">{actorGuidance(stage)}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              {stage.evidenceBundleHashPrefix && (
                <span>evidence {stage.evidenceBundleHashPrefix}</span>
              )}
              {stage.policyVersion && <span>policy v{stage.policyVersion}</span>}
              {stage.reviewerActorLabel && <span>reviewer {stage.reviewerActorLabel}</span>}
            </div>
            {stage.reviewerNotes && (
              <p className="mt-2 text-xs italic text-[var(--muted)]">{stage.reviewerNotes}</p>
            )}
            {stage.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => void handleAction(stage.id, "approve")}
                  disabled={busy !== null}
                  size="sm"
                  variant="primary"
                  className="bg-[var(--success)] text-[var(--success-foreground)] shadow-[0_18px_40px_rgba(34,197,94,0.18)] hover:bg-[var(--success)]/90"
                >
                  Approve stage
                </Button>
                <Button
                  onClick={() => void handleAction(stage.id, "reject")}
                  disabled={busy !== null}
                  size="sm"
                  variant="danger"
                >
                  Reject
                </Button>
                {!stage.required && (
                  <Button
                    onClick={() => void handleAction(stage.id, "skip")}
                    disabled={busy !== null}
                    size="sm"
                    variant="secondary"
                  >
                    Skip
                  </Button>
                )}
              </div>
            )}
          </Surface>
        ))}
      </div>
    </Surface>
  );
}
