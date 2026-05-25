import { createHash } from "crypto";
import { canonicalJson } from "../audit-ledger/canonical-json";
import type { EngineeringPolicyDefinition } from "./policy-types";

export function hashPolicyDefinition(policy: EngineeringPolicyDefinition): string {
  const canonical = canonicalJson({
    id: policy.id,
    name: policy.name,
    version: policy.version,
    rules: policy.rules.map((rule) => ({
      id: rule.id,
      outcome: rule.outcome,
      description: rule.description,
    })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
