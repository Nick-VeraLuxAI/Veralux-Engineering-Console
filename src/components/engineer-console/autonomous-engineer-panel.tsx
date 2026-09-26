"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "./status-badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

export interface AutonomousProgressPayload {
  runId: string;
  taskId: string;
  mode?: string;
  status: string;
  runStatus: string;
  iteration: { current: number; max: number };
  strategy: string | null;
  deliveryCandidateStatus: string;
  clarification: {
    question: string;
    context: string;
    askedAt: string;
    answer: string | null;
    answeredAt: string | null;
    answeredBy: string | null;
  } | null;
  failureClass: string | null;
  escalationReason: string | null;
  worktree: {
    path: string;
    branchName: string;
    baseRevision: string;
    status: string;
  } | null;
  priorAttempts?: Array<{
    iteration: number;
    workerPlanId: string | null;
    outcome: string;
    summary: string;
    failureClass: string | null;
  }>;
  failedHypotheses?: Array<{ iteration: number; hypothesis: string; whyFailed: string }>;
  reviews?: Array<{ review: string; passed: boolean; actionableDefects: string[] }>;
  completionEvaluation?: { complete: boolean; summary: string } | null;
  currentPlanId?: string | null;
  qualityGates?: Array<{ command: string; status: string }>;
  humanGatesRemaining?: string[];
  director?: {
    objectiveResult: string;
    whatItIsDoing: string;
    needsDirector: boolean;
    finished: boolean;
    qcVersusBaseline: {
      baselineFailureCount: number;
      newRegressions: string[];
      preExistingFailures: string[];
      objectiveQcPassed: boolean | null;
    };
    whatChanged: string[];
    risks: string[];
    decision: string;
    nextAction: string;
  } | null;
  workerModel?: {
    route: string;
    providerName: string;
    modelName: string;
    mockBypassed: boolean;
    rolesInvoked: string[];
    requestPath?: string;
  } | null;
  objective?: string;
  qcBaseline?: { failures: Array<{ name: string }>; capturedAt?: string } | null;
  qcDelta?: {
    newFailures: Array<{ identity: { name: string } }>;
    preExistingFailures: Array<{ identity: { name: string } }>;
    resolvedBaselineFailures?: Array<{ identity: { name: string } }>;
    objectiveQcPassed?: boolean | null;
  } | null;
  openRisks?: Array<{ summary: string }>;
  unresolvedDefects?: Array<{ summary: string }>;
  workerPlans?: Array<{ id: string; summary: string; iterationNumber: number | null }>;
}

function progressLabel(status: string, hasDiagnosis: boolean): string {
  if (status === "quality_checking") return "verifying";
  if (status === "evaluating_completion") return "completion";
  if (status === "planning" && hasDiagnosis) return "replanning";
  return status;
}

export function AutonomousEngineerPanel({
  runId,
  payload,
}: {
  runId: string;
  payload: AutonomousProgressPayload;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [abortReason, setAbortReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const waiting = payload.status === "waiting_for_director";
  const deliveryReady = payload.deliveryCandidateStatus === "ready";
  const hasDiagnosis = Boolean(payload.failedHypotheses && payload.failedHypotheses.length > 0);
  const visibleStatus = progressLabel(payload.status, hasDiagnosis);
  const qcBaselineCount = payload.director?.qcVersusBaseline.baselineFailureCount
    ?? payload.qcBaseline?.failures.length
    ?? 0;
  const newRegressions = payload.director?.qcVersusBaseline.newRegressions
    ?? payload.qcDelta?.newFailures.map((item) => item.identity.name)
    ?? [];
  const preExisting = payload.director?.qcVersusBaseline.preExistingFailures
    ?? payload.qcDelta?.preExistingFailures.map((item) => item.identity.name)
    ?? [];
  const implementationSummary =
    payload.workerPlans?.[payload.workerPlans.length - 1]?.summary
    ?? payload.completionEvaluation?.summary
    ?? payload.strategy
    ?? "No implementation summary yet";

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/autonomous/clarification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to resume");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume");
    } finally {
      setBusy(false);
    }
  }

  async function abort() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/autonomous/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: abortReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to abort");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to abort");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface as="section" id="autonomous-engineer-panel" className="mb-6 scroll-mt-28">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Autonomous Engineer</h2>
        <StatusBadge status={visibleStatus} />
        <span className="text-xs text-[var(--muted)]">
          Iteration {payload.iteration.current}/{payload.iteration.max}
        </span>
      </div>
      {payload.objective ? (
        <p className="mb-3 text-sm text-white" data-testid="ae-objective">
          {payload.objective}
        </p>
      ) : null}
      <p className="mb-3 text-sm text-[var(--muted)]">
        The control plane is investigating, planning, executing via worker plans, and running
        allowlisted QC. Manual plan submit and QC retry are not required in this mode. PR, merge,
        deploy, and sign-off stay human gates.
      </p>
      <dl className="mb-4 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">What is it doing?</dt>
          <dd className="text-white" data-testid="ae-progress">
            {visibleStatus}: {payload.director?.whatItIsDoing ?? payload.strategy ?? payload.status}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Does it need me?</dt>
          <dd className="text-white">{payload.director?.needsDirector || waiting ? "Yes — clarification" : "No"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Did it finish?</dt>
          <dd className="text-white">{payload.director?.finished || deliveryReady ? "Delivery candidate ready" : "Not yet"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">QC vs baseline?</dt>
          <dd className="text-white" data-testid="ae-qc-delta">
            {payload.director
              ? `baseline ${qcBaselineCount} / ${newRegressions.length} new / ${preExisting.length} pre-existing`
              : "Recording"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">What changed?</dt>
          <dd className="text-white">{payload.director?.whatChanged[0] ?? payload.strategy ?? "No mutation yet"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Risks?</dt>
          <dd className="text-white">{payload.director?.risks[0] ?? payload.failureClass ?? "None disclosed"}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">What decision?</dt>
          <dd className="text-white">
            {payload.director?.nextAction ?? (deliveryReady ? "Authorize PR" : "Wait")}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Worker</dt>
          <dd className="text-white" data-testid="ae-worker">
            {payload.workerModel
              ? `${payload.workerModel.providerName} / ${payload.workerModel.modelName} (${payload.workerModel.route}${payload.workerModel.mockBypassed ? ", mock bypassed" : ""})`
              : "Not recorded"}
          </dd>
        </div>
      </dl>
      {payload.strategy ? (
        <p className="mb-3 text-sm text-white">{payload.strategy}</p>
      ) : null}
      {payload.worktree ? (
        <p className="mb-3 font-mono text-xs text-[var(--muted)]">
          Isolated worktree {payload.worktree.branchName} @ {payload.worktree.baseRevision.slice(0, 12)}
        </p>
      ) : null}
      {payload.failureClass ? (
        <p className="mb-3 text-sm text-amber-200">
          {payload.failureClass}: {payload.escalationReason}
        </p>
      ) : null}

      {waiting && payload.clarification ? (
        <Surface className="mb-4" padding="sm" variant="warning" data-testid="ae-clarification">
          <p className="font-medium text-white">Director clarification required</p>
          <p className="mt-2 text-sm">{payload.clarification.question}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{payload.clarification.context}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm"
            placeholder="Answer to resume the same run"
          />
          <Button className="mt-3" disabled={busy || !answer.trim()} onClick={() => void resume()}>
            {busy ? "Resuming…" : "Resume"}
          </Button>
        </Surface>
      ) : null}

      {deliveryReady ? (
        <Surface className="mb-4" padding="sm" variant="inset" data-testid="ae-delivery-candidate">
          <p className="font-medium text-white">Delivery candidate ready</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-[var(--muted)]">Objective</dt>
              <dd className="text-white">{payload.objective ?? payload.director?.decision}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Status</dt>
              <dd className="text-white">{payload.status} / {payload.deliveryCandidateStatus}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Implementation summary</dt>
              <dd className="text-white">{implementationSummary}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Iterations</dt>
              <dd className="text-white">
                {payload.iteration.current} / {payload.iteration.max}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">QC baseline / post</dt>
              <dd className="text-white">
                baseline {qcBaselineCount} failures; post new {newRegressions.length}; pre-existing {preExisting.length}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">New regressions</dt>
              <dd className="text-white">{newRegressions.join("; ") || "None"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Pre-existing</dt>
              <dd className="text-white">{preExisting.join("; ") || "None disclosed"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Reviews</dt>
              <dd className="text-white">
                {(payload.reviews ?? []).map((review) => `${review.review}:${review.passed ? "pass" : "fail"}`).join(", ")
                  || "None"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Risks</dt>
              <dd className="text-white">
                {(payload.director?.risks ?? payload.openRisks?.map((risk) => risk.summary) ?? []).join("; ")
                  || "None disclosed"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Evidence</dt>
              <dd className="text-white">
                {payload.worktree
                  ? `${payload.worktree.branchName} @ ${payload.worktree.baseRevision.slice(0, 12)}`
                  : "Worktree recorded on the run"}
                {payload.currentPlanId ? ` · plan ${payload.currentPlanId.slice(0, 8)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Next governed action</dt>
              <dd className="text-white">
                {payload.director?.nextAction ?? "Authorize PR"}
                {payload.humanGatesRemaining ? ` (${payload.humanGatesRemaining.join(", ")})` : ""}
              </dd>
            </div>
          </dl>
        </Surface>
      ) : null}

      {payload.priorAttempts && payload.priorAttempts.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium">Iteration history</h3>
          <ul className="space-y-2 text-sm">
            {payload.priorAttempts.map((attempt) => (
              <li key={`${attempt.iteration}-${attempt.workerPlanId}`} className="text-[var(--muted)]">
                #{attempt.iteration} {attempt.outcome}
                {attempt.failureClass ? ` (${attempt.failureClass})` : ""} — {attempt.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <label className="block text-sm text-[var(--muted)]">
          Director abort
          <input
            value={abortReason}
            onChange={(e) => setAbortReason(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-sm"
            placeholder="Reason required"
          />
        </label>
        <Button
          className="mt-2"
          variant="secondary"
          disabled={busy || !abortReason.trim()}
          onClick={() => void abort()}
        >
          Abort run
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </Surface>
  );
}
