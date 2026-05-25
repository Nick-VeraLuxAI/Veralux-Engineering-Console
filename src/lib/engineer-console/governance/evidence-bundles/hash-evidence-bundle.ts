import { createHash } from "crypto";
import { canonicalJson } from "../audit-ledger/canonical-json";
import type { RunEvidenceBundleV1 } from "./evidence-bundle-types";

export function hashEvidenceBundle(bundle: RunEvidenceBundleV1): string {
  return createHash("sha256").update(canonicalJson(bundle), "utf8").digest("hex");
}
