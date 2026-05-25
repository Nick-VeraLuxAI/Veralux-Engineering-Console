import type {
  OperatorQueueBucketId,
  OperatorQueueItem,
  OperatorQueueSection,
} from "./operator-queue";

export type OperatorQueuePresetId =
  | "all"
  | "my_next_actions"
  | "blocked_failed"
  | "approval_queue"
  | "pr_release_queue"
  | "stale_runs"
  | "recently_completed"
  | "staging_setup";

export type OperatorQueueDensityMode = "detailed" | "compact";

export interface OperatorQueuePresetDefinition {
  id: OperatorQueuePresetId;
  label: string;
  queryValue: string;
  description: string;
}

const BUCKET_TITLES: Record<OperatorQueueBucketId, string> = {
  needs_action: "Needs operator action",
  blocked_failed: "Blocked / failed",
  ready_for_approval: "Ready for approval",
  ready_for_release: "Ready for PR / release",
  recently_completed: "Recently completed",
  setup_attention: "Staging checklist / setup attention",
};

const BUCKET_ORDER: OperatorQueueBucketId[] = [
  "needs_action",
  "blocked_failed",
  "ready_for_approval",
  "ready_for_release",
  "recently_completed",
  "setup_attention",
];

export const OPERATOR_QUEUE_PRESETS: OperatorQueuePresetDefinition[] = [
  {
    id: "all",
    label: "All",
    queryValue: "all",
    description: "Show the full queue.",
  },
  {
    id: "my_next_actions",
    label: "My next actions",
    queryValue: "next",
    description: "Show actionable task and run follow-up.",
  },
  {
    id: "blocked_failed",
    label: "Blocked / failed",
    queryValue: "blocked",
    description: "Show failed runs and blocked release work.",
  },
  {
    id: "approval_queue",
    label: "Approval queue",
    queryValue: "approval",
    description: "Show approval and review follow-up.",
  },
  {
    id: "pr_release_queue",
    label: "PR / release queue",
    queryValue: "release",
    description: "Show PR, merge, deployment, checklist, and sign-off follow-up.",
  },
  {
    id: "stale_runs",
    label: "Stale runs",
    queryValue: "stale",
    description: "Show advisory stale-run follow-up only.",
  },
  {
    id: "recently_completed",
    label: "Recently completed",
    queryValue: "completed",
    description: "Show recent completed work.",
  },
  {
    id: "staging_setup",
    label: "Staging setup",
    queryValue: "staging",
    description: "Show setup and manual staging follow-up.",
  },
];

export const DEFAULT_OPERATOR_QUEUE_PRESET: OperatorQueuePresetId = "all";

const PRESET_BY_QUERY = new Map(
  OPERATOR_QUEUE_PRESETS.map((preset) => [preset.queryValue, preset.id]),
);

export function resolveOperatorQueuePresetId(
  value: string | string[] | null | undefined,
): OperatorQueuePresetId {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return DEFAULT_OPERATOR_QUEUE_PRESET;
  return PRESET_BY_QUERY.get(raw) ?? DEFAULT_OPERATOR_QUEUE_PRESET;
}

export function queuePresetToQueryValue(presetId: OperatorQueuePresetId): string {
  return (
    OPERATOR_QUEUE_PRESETS.find((preset) => preset.id === presetId)?.queryValue ??
    DEFAULT_OPERATOR_QUEUE_PRESET
  );
}

export function getOperatorQueuePreset(
  presetId: OperatorQueuePresetId,
): OperatorQueuePresetDefinition {
  return (
    OPERATOR_QUEUE_PRESETS.find((preset) => preset.id === presetId) ??
    OPERATOR_QUEUE_PRESETS[0]!
  );
}

export function buildOperatorQueueSections(
  items: OperatorQueueItem[],
  preset: OperatorQueuePresetId,
): OperatorQueueSection[] {
  const filtered = items.filter((item) => {
    switch (preset) {
      case "my_next_actions":
        return item.bucket !== "recently_completed" && item.bucket !== "setup_attention";
      case "blocked_failed":
        return item.bucket === "blocked_failed";
      case "approval_queue":
        return item.bucket === "ready_for_approval";
      case "pr_release_queue":
        return item.bucket === "ready_for_release";
      case "stale_runs":
        return item.isStale;
      case "recently_completed":
        return item.bucket === "recently_completed";
      case "staging_setup":
        return item.bucket === "setup_attention";
      default:
        return true;
    }
  });

  return BUCKET_ORDER.map((bucket) => ({
    id: bucket,
    title: BUCKET_TITLES[bucket],
    items: filtered
      .filter((item) => item.bucket === bucket)
      .sort((left, right) => right.priority - left.priority || left.sortKey.localeCompare(right.sortKey)),
  })).filter((section) => section.items.length > 0);
}

export function hasOperatorQueueActionableItems(items: OperatorQueueItem[]): boolean {
  return items.some((item) => item.bucket !== "recently_completed");
}
