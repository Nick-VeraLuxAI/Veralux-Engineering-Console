/** Explicit senior approval gate — machine-verifiable, request-bound. */

import { createHash } from "crypto";
import {
  S14_RUNTIME_ID,
  type MaxNewTokens,
  type SeniorApprovalArtifact,
  type SeniorBlockReason,
  type SeniorGenerationRequest,
} from "./types";

export function hashApprovalArtifact(artifact: Omit<SeniorApprovalArtifact, "artifactHash" | "schema">): string {
  const canonical = JSON.stringify({
    approvalReference: artifact.approvalReference,
    veraRequestId: artifact.veraRequestId,
    runtimeId: artifact.runtimeId,
    operation: artifact.operation,
    approverIdentity: artifact.approverIdentity,
    approvedAt: artifact.approvedAt,
    expiresAt: artifact.expiresAt,
    oneUse: artifact.oneUse,
    scope: artifact.scope,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createSeniorApprovalArtifact(input: {
  veraRequestId: string;
  approvalReference?: string;
  runtimeId?: string;
  approverIdentity?: string;
  approvedAt?: string;
  expiresAt?: string | null;
  oneUse?: boolean;
  maxNewTokens: MaxNewTokens;
}): SeniorApprovalArtifact {
  const base = {
    approvalReference: input.approvalReference ?? `s14-approval-${input.veraRequestId}`,
    veraRequestId: input.veraRequestId,
    runtimeId: input.runtimeId ?? S14_RUNTIME_ID,
    operation: "senior_generate" as const,
    approverIdentity: input.approverIdentity ?? "s14-verification-operator",
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt === undefined ? null : input.expiresAt,
    oneUse: input.oneUse ?? true,
    scope: {
      maxNewTokens: input.maxNewTokens,
      generationPolicy: "greedy" as const,
    },
  };
  return {
    schema: "s14_senior_execution_approval_v1",
    ...base,
    artifactHash: hashApprovalArtifact(base),
  };
}

export type ApprovalValidationResult =
  | { ok: true; artifact: SeniorApprovalArtifact }
  | { ok: false; reason: SeniorBlockReason; message: string };

export function validateSeniorApproval(
  request: SeniorGenerationRequest,
  artifact: SeniorApprovalArtifact | null | undefined,
  options: { nowMs?: number; consumedReferences?: Set<string> } = {},
): ApprovalValidationResult {
  const nowMs = options.nowMs ?? Date.now();
  const consumedReferences = options.consumedReferences ?? new Set<string>();
  if (!artifact) {
    return { ok: false, reason: "senior_execution_approval_missing", message: "approval artifact missing" };
  }
  if (artifact.schema !== "s14_senior_execution_approval_v1") {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "unknown approval schema" };
  }
  const expectedHash = hashApprovalArtifact(artifact);
  if (artifact.artifactHash !== expectedHash) {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "approval artifact hash mismatch" };
  }
  if (artifact.veraRequestId !== request.veraRequestId) {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "approval not bound to request id" };
  }
  if (artifact.runtimeId !== (request.runtimeId ?? S14_RUNTIME_ID)) {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "approval runtime mismatch" };
  }
  if (artifact.operation !== "senior_generate") {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "approval operation is not execution" };
  }
  if (artifact.approvalReference !== request.approvalReference) {
    return { ok: false, reason: "senior_execution_approval_mismatch", message: "approval reference mismatch" };
  }
  if (artifact.scope.generationPolicy !== "greedy") {
    return { ok: false, reason: "senior_execution_approval_scope_mismatch", message: "unsupported generation policy" };
  }
  if (request.maxNewTokens > artifact.scope.maxNewTokens) {
    return {
      ok: false,
      reason: "senior_execution_approval_scope_mismatch",
      message: `token count ${request.maxNewTokens} exceeds approved ${artifact.scope.maxNewTokens}`,
    };
  }
  if (artifact.expiresAt) {
    const exp = Date.parse(artifact.expiresAt);
    if (!Number.isFinite(exp) || nowMs > exp) {
      return { ok: false, reason: "senior_execution_approval_expired", message: "approval expired" };
    }
  }
  if (artifact.oneUse && consumedReferences.has(artifact.approvalReference)) {
    return { ok: false, reason: "senior_execution_approval_expired", message: "one-use approval already consumed" };
  }
  return { ok: true, artifact };
}
