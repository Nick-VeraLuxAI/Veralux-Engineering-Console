/** Senior route eligibility + decision (no S13 call). */

import { validateSeniorApproval } from "./approval-gate";
import {
  S14_CONFIGURED_MAX_NEW_TOKENS,
  S14_RUNTIME_ID,
  type SeniorApprovalArtifact,
  type SeniorGenerationRequest,
  type SeniorRouteDecision,
} from "./types";

export type RouteGateInput = {
  request: SeniorGenerationRequest;
  approval: SeniorApprovalArtifact | null;
  routeEnabled?: boolean;
  runtimeAvailable?: boolean;
  consumedApprovals?: Set<string>;
  nowMs?: number;
  configuredMaxNewTokens?: number;
};

export function evaluateSeniorRouteDecision(input: RouteGateInput): SeniorRouteDecision {
  const now = new Date(input.nowMs ?? Date.now()).toISOString();
  const request = input.request;
  const configuredMax = input.configuredMaxNewTokens ?? S14_CONFIGURED_MAX_NEW_TOKENS;
  const base = {
    runtimeId: request.runtimeId ?? S14_RUNTIME_ID,
    approvalReference: request.approvalReference || null,
    requestId: request.veraRequestId,
    decidedAt: now,
  };

  if (input.routeEnabled === false) {
    return { ...base, eligible: false, approved: false, reason: "senior_route_disabled" };
  }
  if (!request.seniorRequested) {
    return { ...base, eligible: false, approved: false, reason: "senior_execution_not_requested" };
  }
  if (!request.prompt || !request.prompt.trim()) {
    return { ...base, eligible: false, approved: false, reason: "senior_request_shape_unsupported" };
  }
  if (
    !Number.isInteger(request.maxNewTokens) ||
    request.maxNewTokens < 1 ||
    request.maxNewTokens > configuredMax
  ) {
    return { ...base, eligible: false, approved: false, reason: "senior_request_shape_unsupported" };
  }
  if ((request.runtimeId ?? S14_RUNTIME_ID) !== S14_RUNTIME_ID) {
    return { ...base, eligible: false, approved: false, reason: "senior_runtime_not_available" };
  }
  if (input.runtimeAvailable === false) {
    return { ...base, eligible: false, approved: false, reason: "senior_runtime_not_available" };
  }

  const approval = validateSeniorApproval(request, input.approval, {
    nowMs: input.nowMs,
    consumedReferences: input.consumedApprovals ?? new Set(),
  });
  if (!approval.ok) {
    return { ...base, eligible: true, approved: false, reason: approval.reason };
  }

  return {
    ...base,
    eligible: true,
    approved: true,
    approvalReference: approval.artifact.approvalReference,
    reason: "explicit_senior_execution_approved",
  };
}
