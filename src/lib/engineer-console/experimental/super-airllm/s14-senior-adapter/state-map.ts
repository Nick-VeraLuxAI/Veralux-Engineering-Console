/** Map S13 request states → VeraLux senior adapter states. */

import type { SeniorAdapterState } from "./types";

const TERMINAL_S13 = new Set(["completed", "cancelled", "failed", "blocked", "recovery_required"]);

export function mapS13StateToSenior(s13State: string | null | undefined): SeniorAdapterState {
  switch (s13State) {
    case "queued":
    case "admitted":
      return "senior_queued";
    case "waiting_for_gpu":
    case "stopping_nano":
    case "starting_worker":
      return "senior_acquiring_runtime";
    case "tokenizing":
    case "embedding":
    case "streaming_layers":
    case "final_norm":
    case "lm_head":
    case "selecting_token":
    case "checkpointed":
    case "running_request":
      return "senior_executing";
    case "restoring_nano":
      return "senior_operational_cleanup";
    case "cancellation_requested":
    case "cancelling":
      return "senior_executing";
    case "completed":
      return "senior_completed";
    case "cancelled":
      return "senior_cancelled";
    case "recovery_required":
      return "senior_recovery_required";
    case "failed":
    case "blocked":
      return "senior_failed";
    default:
      return "senior_status_unknown";
  }
}

export function isTerminalS13State(state: string | null | undefined): boolean {
  return Boolean(state && TERMINAL_S13.has(state));
}
