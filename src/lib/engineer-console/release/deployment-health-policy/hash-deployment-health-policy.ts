import { createHash } from "crypto";
import { canonicalJson } from "../../governance/audit-ledger/canonical-json";
import type { DeploymentHealthPolicyDefinition } from "./deployment-health-policy-types";

export function hashDeploymentHealthPolicyDefinition(
  policy: DeploymentHealthPolicyDefinition,
): string {
  const canonical = canonicalJson({
    id: policy.id,
    name: policy.name,
    version: policy.version,
    rules: policy.rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
    })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
