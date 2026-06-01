import { createHash } from "crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export function stableSnapshotStringify(snapshot: unknown): string {
  return JSON.stringify(sortValue(snapshot));
}

export function hashEvidenceSnapshot(snapshot: unknown): string {
  return createHash("sha256").update(stableSnapshotStringify(snapshot)).digest("hex");
}
