"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import type { MainlineSafeTaskExecutionDemo } from "@/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo";
import type { MainlineTaskRunProof } from "@/lib/engineer-console/mainline-runtime/mainline-task-run-proof";

export const SAFE_MAINLINE_DEMO_ENDPOINT = "/api/engineer-console/mainline-runtime/safe-task-demo";

export type SafeMainlineDemoActionState = "idle" | "running" | "success" | "error";

export interface SafeMainlineDemoApiResponse {
  status: string;
  proof: MainlineSafeTaskExecutionDemo;
}

function StatusLine({ label, value }: { label: string; value: string | boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium text-white">{String(value)}</p>
    </div>
  );
}

export async function triggerSafeMainlineDemo(
  fetchFn: typeof fetch = fetch,
): Promise<SafeMainlineDemoApiResponse> {
  const response = await fetchFn(SAFE_MAINLINE_DEMO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json() as Partial<SafeMainlineDemoApiResponse> & { error?: string };
  if (!response.ok || !body.proof) {
    throw new Error(body.error ?? `Safe mainline demo failed with status ${response.status}`);
  }
  return {
    status: body.status ?? "safe_mainline_task_demo_api_trigger_passed_awaiting_user_approval",
    proof: body.proof,
  };
}

export function MainlineRuntimeProofPanelStatus({
  actionState,
  demoProof,
  errorMessage,
}: {
  actionState: SafeMainlineDemoActionState;
  demoProof: MainlineSafeTaskExecutionDemo | null;
  errorMessage: string | null;
}) {
  if (actionState === "running") {
    return (
      <div
        className="mt-4 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100"
        data-safe-demo-state="running"
      >
        Running safe mainline demo. The action is evidence-only and cannot integrate changes.
      </div>
    );
  }
  if (actionState === "error") {
    return (
      <div
        className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100"
        data-safe-demo-state="error"
      >
        <p className="font-medium">Safe demo did not complete.</p>
        <p className="mt-1">{errorMessage ?? "Unknown error"}</p>
        <p className="mt-2 text-red-100/80">
          No fallback, escalation, or integration was triggered. Approval remains required.
        </p>
      </div>
    );
  }
  if (actionState === "success" && demoProof) {
    return (
      <div
        className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100"
        data-safe-demo-state="success"
      >
        <p className="font-medium">Safe demo completed and evidence was packaged.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusLine label="Final state" value={demoProof.finalState} />
          <StatusLine label="Evidence path" value={demoProof.evidencePackage.path} />
          <StatusLine label="Approval required" value={demoProof.safetyInvariants.approvalRequired} />
          <StatusLine label="Integration performed" value={demoProof.safetyInvariants.integrationPerformed} />
          <StatusLine label="Fallback used" value={demoProof.safetyInvariants.fallbackUsed} />
          <StatusLine label="Qwen used" value={demoProof.safetyInvariants.qwenUsed} />
          <StatusLine label="Super required" value={demoProof.safetyInvariants.superRequired} />
          <StatusLine label="Mixtral required" value={demoProof.safetyInvariants.mixtralRequired} />
        </div>
      </div>
    );
  }
  return (
    <p className="mt-4 text-sm text-[var(--muted)]" data-safe-demo-state="idle">
      This action runs only the guarded evidence-directory demo and stops before integration.
    </p>
  );
}

export function MainlineRuntimeProofPanel({ proof }: { proof: MainlineTaskRunProof }) {
  const [actionState, setActionState] = React.useState<SafeMainlineDemoActionState>("idle");
  const [demoProof, setDemoProof] = React.useState<MainlineSafeTaskExecutionDemo | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const vera = proof.runtimeContract.activeRoles.find((role) => role.roleId === "vera_command");
  const consoleWorker = proof.runtimeContract.activeRoles.find((role) => role.roleId === "console_default_worker");
  const senior = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_senior_worker");
  const mixtral = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_cold_senior_reviewer");

  async function runSafeDemo() {
    setActionState("running");
    setErrorMessage(null);
    try {
      const result = await triggerSafeMainlineDemo();
      setDemoProof(result.proof);
      setActionState("success");
    } catch (error) {
      setDemoProof(null);
      setErrorMessage(error instanceof Error ? error.message : "Safe demo failed.");
      setActionState("error");
    }
  }

  return (
    <Surface
      variant="glass"
      padding="lg"
      className="mb-4"
      data-mainline-runtime-proof-panel="true"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Nano mainline runtime
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Local task proof</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            The deterministic proof is visible through the Console surface and stops at user approval.
          </p>
        </div>
        <Badge variant="warning" size="md">
          {proof.finalState.replace(/_/g, " ")}
        </Badge>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">Run the safe evidence-only mainline demo</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Calls the guarded API trigger, writes only under evidence/nano-mainline-runtime, and stops at approval.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={runSafeDemo}
          disabled={actionState === "running"}
          data-safe-demo-trigger="true"
        >
          {actionState === "running" ? "Running..." : "Run Safe Mainline Demo"}
        </button>
      </div>

      <MainlineRuntimeProofPanelStatus
        actionState={actionState}
        demoProof={demoProof}
        errorMessage={errorMessage}
      />

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusLine label="Vera runtime" value={`${vera?.model ?? "unknown"} @ ${vera?.endpoint ?? "missing"}`} />
        <StatusLine label="Console runtime" value={`${consoleWorker?.model ?? "unknown"} @ ${consoleWorker?.endpoint ?? "missing"}`} />
        <StatusLine label="Approval required" value={proof.safetyInvariants.approvalRequired} />
        <StatusLine label="Integration performed" value={proof.safetyInvariants.integrationPerformed} />
        <StatusLine label="Fallback used" value={proof.safetyInvariants.fallbackUsed} />
        <StatusLine label="Qwen used" value={proof.safetyInvariants.qwenUsed} />
        <StatusLine label="Senior required" value={proof.runtimeContract.safetyPolicy.seniorRuntimeRequired} />
        <StatusLine label="Production files changed" value={proof.safetyInvariants.productionFilesChanged} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Parked senior runtime</p>
          <p className="mt-1 text-sm text-white">
            {senior?.runtimeName ?? "Senior"}: {senior?.promotionStatus ?? "blocked"}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Parked cold reviewer</p>
          <p className="mt-1 text-sm text-white">
            {mixtral?.runtimeName ?? "Mixtral"}: {mixtral?.promotionStatus ?? "parked"}
          </p>
        </div>
      </div>
    </Surface>
  );
}
