import React from "react";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import type { MainlineTaskRunProof } from "@/lib/engineer-console/mainline-runtime/mainline-task-run-proof";

function StatusLine({ label, value }: { label: string; value: string | boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium text-white">{String(value)}</p>
    </div>
  );
}

export function MainlineRuntimeProofPanel({ proof }: { proof: MainlineTaskRunProof }) {
  const vera = proof.runtimeContract.activeRoles.find((role) => role.roleId === "vera_command");
  const consoleWorker = proof.runtimeContract.activeRoles.find((role) => role.roleId === "console_default_worker");
  const senior = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_senior_worker");
  const mixtral = proof.runtimeContract.parkedRoles.find((role) => role.roleId === "console_cold_senior_reviewer");

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
