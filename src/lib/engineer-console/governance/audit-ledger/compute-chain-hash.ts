import { createHash } from "crypto";

/** Deterministic chain hash for one append (must match `appendAuditEvent`). */
export function computeChainHash(input: {
  previousChainHash: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payloadHash: string;
  createdAt: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.previousChainHash,
        input.eventType,
        input.entityType,
        input.entityId,
        input.payloadHash,
        input.createdAt,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}
