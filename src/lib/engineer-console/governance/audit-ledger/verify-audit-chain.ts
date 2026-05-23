import { canonicalJson } from "./canonical-json";
import { computeChainHash } from "./compute-chain-hash";
import { hashAuditPayload, redactAuditPayload } from "./hash-audit-payload";
import {
  AUDIT_CHAIN_GENESIS,
  type AuditChainVerificationResult,
  type AuditEventRecord,
} from "./audit-ledger-types";

export type VerifyAuditEventInput = Pick<
  AuditEventRecord,
  | "eventType"
  | "entityType"
  | "entityId"
  | "payloadHash"
  | "payloadJson"
  | "previousEventHash"
  | "chainHash"
  | "createdAt"
>;

function parsePayloadJson(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

/**
 * Verifies an ordered audit chain.
 * Does not throw on tampering — returns structured failures.
 */
export function verifyAuditChain(events: VerifyAuditEventInput[]): AuditChainVerificationResult {
  const failures: string[] = [];
  const checkedCount = events.length;

  if (events.length === 0) {
    return { ok: true, checkedCount: 0, failures };
  }

  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const previousHashCounts = new Map<string, number>();
  const chainHashCounts = new Map<string, number>();

  for (const event of sorted) {
    if (event.previousEventHash) {
      previousHashCounts.set(
        event.previousEventHash,
        (previousHashCounts.get(event.previousEventHash) ?? 0) + 1,
      );
    }
    chainHashCounts.set(event.chainHash, (chainHashCounts.get(event.chainHash) ?? 0) + 1);
  }

  for (const [hash, count] of previousHashCounts) {
    if (count > 1) failures.push(`duplicate_previous_hash:${hash}`);
  }
  for (const [hash, count] of chainHashCounts) {
    if (count > 1) failures.push(`duplicate_chain_hash:${hash}`);
  }

  let expectedPrevious: string = AUDIT_CHAIN_GENESIS;

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i]!;
    const storedPrevious = event.previousEventHash ?? AUDIT_CHAIN_GENESIS;

    if (storedPrevious !== expectedPrevious) {
      failures.push(`continuity_break_at_index_${i}`);
    }

    const payload = parsePayloadJson(event.payloadJson);
    const recomputedPayloadHash = hashAuditPayload(redactAuditPayload(payload));
    if (recomputedPayloadHash !== event.payloadHash) {
      failures.push(`payload_hash_mismatch_at_index_${i}`);
    }

    const recomputedChain = computeChainHash({
      previousChainHash: expectedPrevious,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      payloadHash: event.payloadHash,
      createdAt: event.createdAt,
    });

    if (recomputedChain !== event.chainHash) {
      failures.push(`chain_hash_mismatch_at_index_${i}`);
    }

    if (!event.chainHash || !event.payloadHash) {
      failures.push(`malformed_row_at_index_${i}`);
    }

    expectedPrevious = event.chainHash;
  }

  return { ok: failures.length === 0, checkedCount, failures };
}

/** Stable serialization for tests comparing payload hashes. */
export function stablePayloadHash(payload: Record<string, unknown>): string {
  return hashAuditPayload(payload);
}

export function stablePayloadCanonical(payload: Record<string, unknown>): string {
  return canonicalJson(redactAuditPayload(payload));
}
