import React from "react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-600",
  queued: "bg-blue-600",
  running: "bg-amber-600",
  waiting_for_approval: "bg-purple-600",
  approved: "bg-emerald-600",
  failed: "bg-red-600",
  stopped: "bg-orange-700",
  completed: "bg-emerald-700",
  warning: "bg-amber-700",
  missing: "bg-red-700",
  not_checked: "bg-zinc-700",
  pending: "bg-zinc-500",
  preparing_workspace: "bg-blue-500",
  creating_branch: "bg-blue-500",
  generating_patch: "bg-amber-500",
  applying_patch: "bg-amber-500",
  validating_worker_plan: "bg-cyan-600",
  executing_worker_plan: "bg-cyan-700",
  running_quality_gates: "bg-indigo-500",
  low: "bg-emerald-600",
  medium: "bg-amber-600",
  high: "bg-orange-600",
  blocked: "bg-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-zinc-600";
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium text-white ${color}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
