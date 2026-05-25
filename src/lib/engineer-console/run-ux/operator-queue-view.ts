import type {
  OperatorQueueBucketId,
  OperatorQueueFilterId,
  OperatorQueueItem,
  OperatorQueueSection,
} from "./operator-queue";

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

export function buildOperatorQueueSections(
  items: OperatorQueueItem[],
  filter: OperatorQueueFilterId,
): OperatorQueueSection[] {
  const filtered = items.filter((item) => {
    switch (filter) {
      case "needs_action":
        return item.bucket === "needs_action" || item.bucket === "setup_attention";
      case "blocked":
        return item.bucket === "blocked_failed";
      case "approval":
        return item.bucket === "ready_for_approval";
      case "pr_release":
        return item.bucket === "ready_for_release";
      case "completed":
        return item.bucket === "recently_completed";
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
