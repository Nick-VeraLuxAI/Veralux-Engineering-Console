import type { SeniorReviewQueueItem, SeniorReviewQueueStore } from "./queue-types";

function cloneItem(item: SeniorReviewQueueItem): SeniorReviewQueueItem {
  return structuredClone(item);
}

export function createSeniorReviewQueueStore(): SeniorReviewQueueStore {
  const items = new Map<string, SeniorReviewQueueItem>();
  return {
    put(item) {
      items.set(item.id, cloneItem(item));
    },
    get(id) {
      const item = items.get(id);
      return item ? cloneItem(item) : null;
    },
    list() {
      return [...items.values()].map(cloneItem);
    },
  };
}

const defaultStore = createSeniorReviewQueueStore();

export function getDefaultSeniorReviewQueueStore(): SeniorReviewQueueStore {
  return defaultStore;
}
