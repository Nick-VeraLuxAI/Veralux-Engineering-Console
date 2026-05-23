import { createHash } from "crypto";
import type { RunEvidenceBundleV1 } from "./evidence-bundle-types";

const SENSITIVE_KEY_PATTERN =
  /^(api[_-]?key|token|secret|password|authorization|cookie|private[_-]?key|rawResponse|raw_response|prompt)$/i;

const MAX_STRING = 500;
const MAX_ARRAY = 100;
const MAX_DIFF_PREVIEW = 800;

export function hashContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function truncateString(value: string, max = MAX_STRING): string {
  const cleaned = stripAnsi(value);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…[truncated]`;
}

function redactUnknown(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_ARRAY).map((item, i) => redactUnknown(item, String(i)));
    if (value.length > MAX_ARRAY) {
      slice.push(`…[${value.length - MAX_ARRAY} more omitted]`);
    }
    return slice;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactUnknown(v, k);
  }
  return out;
}

/** Apply evidence-specific redaction on an already-summarized bundle. */
export function redactEvidenceBundle(bundle: RunEvidenceBundleV1): RunEvidenceBundleV1 {
  const redacted = redactUnknown(bundle) as RunEvidenceBundleV1;

  redacted.taskDescriptionPreview = truncateString(bundle.taskDescriptionPreview, 300);
  redacted.diffStats = {
    ...bundle.diffStats,
    preview: truncateString(bundle.diffStats.preview, MAX_DIFF_PREVIEW),
  };

  redacted.changedFiles = bundle.changedFiles.slice(0, MAX_ARRAY);

  return redacted;
}
