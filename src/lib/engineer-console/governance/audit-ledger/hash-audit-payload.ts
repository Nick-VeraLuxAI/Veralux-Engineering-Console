import { createHash } from "crypto";
import { canonicalJson } from "./canonical-json";

const SENSITIVE_KEY_PATTERN =
  /^(prompt|rawResponse|raw_response|stdout|stderr|secret|token|apiKey|api_key|password|authorization)$/i;

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 50;

/** Redact sensitive fields and bound size before persistence and hashing. */
export function redactAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactValue(payload) as Record<string, unknown>;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_ARRAY_ITEMS).map((item, index) => redactValue(item, String(index)));
    if (value.length > MAX_ARRAY_ITEMS) {
      slice.push(`…[${value.length - MAX_ARRAY_ITEMS} more items omitted]`);
    }
    return slice;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactValue(v, k);
  }
  return out;
}

export function hashAuditPayload(payload: Record<string, unknown>): string {
  const redacted = redactAuditPayload(payload);
  return createHash("sha256").update(canonicalJson(redacted), "utf8").digest("hex");
}
