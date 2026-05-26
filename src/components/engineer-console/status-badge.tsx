import React from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: "muted",
  queued: "info",
  running: "active",
  waiting_for_approval: "warning",
  approved: "ready",
  failed: "blocked",
  stopped: "blocked",
  completed: "completed",
  warning: "warning",
  missing: "blocked",
  not_checked: "muted",
  pending: "muted",
  preparing_workspace: "info",
  creating_branch: "info",
  generating_patch: "active",
  applying_patch: "active",
  validating_worker_plan: "active",
  executing_worker_plan: "active",
  running_quality_gates: "active",
  low: "ready",
  medium: "warning",
  high: "warning",
  blocked: "blocked",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "muted"} size="md">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
