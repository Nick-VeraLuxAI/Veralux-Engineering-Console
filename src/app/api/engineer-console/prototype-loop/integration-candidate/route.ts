import { NextResponse } from "next/server";
import {
  runPrototypeIntegrationCandidateV1,
  type PrototypeIntegrationCandidateRequest,
} from "@/lib/engineer-console/prototype-loop/prototype-integration-candidate";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  const result = await runPrototypeIntegrationCandidateV1(normalizeRequest(body));

  return NextResponse.json(
    result,
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request): Promise<Partial<PrototypeIntegrationCandidateRequest>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Partial<PrototypeIntegrationCandidateRequest> : {};
  } catch {
    return {};
  }
}

function normalizeRequest(body: Partial<PrototypeIntegrationCandidateRequest>): PrototypeIntegrationCandidateRequest {
  return {
    controlled_apply_review_decision_id: typeof body.controlled_apply_review_decision_id === "string" ? body.controlled_apply_review_decision_id : "",
    controlled_apply_id: typeof body.controlled_apply_id === "string" ? body.controlled_apply_id : "",
    controlled_apply_evidence_path: typeof body.controlled_apply_evidence_path === "string" ? body.controlled_apply_evidence_path : "",
    controlled_apply_workspace_path: typeof body.controlled_apply_workspace_path === "string" ? body.controlled_apply_workspace_path : "",
    apply_approval_decision_id: typeof body.apply_approval_decision_id === "string" ? body.apply_approval_decision_id : "",
    apply_proposal_id: typeof body.apply_proposal_id === "string" ? body.apply_proposal_id : "",
    implementation_plan_id: typeof body.implementation_plan_id === "string" ? body.implementation_plan_id : "",
    implementation_request_id: typeof body.implementation_request_id === "string" ? body.implementation_request_id : "",
    approval_decision_id: typeof body.approval_decision_id === "string" ? body.approval_decision_id : "",
    task_id: typeof body.task_id === "string" ? body.task_id : "",
    run_id: typeof body.run_id === "string" ? body.run_id : "",
    prototype_evidence_path: typeof body.prototype_evidence_path === "string" ? body.prototype_evidence_path : "",
    revision_task_id: typeof body.revision_task_id === "string" ? body.revision_task_id : undefined,
    revision_run_id: typeof body.revision_run_id === "string" ? body.revision_run_id : undefined,
    revision_evidence_path: typeof body.revision_evidence_path === "string" ? body.revision_evidence_path : undefined,
    plan_path: typeof body.plan_path === "string" ? body.plan_path : "",
    proposal_path: typeof body.proposal_path === "string" ? body.proposal_path : "",
    controlled_apply_status: typeof body.controlled_apply_status === "string" ? body.controlled_apply_status : "",
    checks_passed: body.checks_passed === true,
    review_required: body.review_required === true,
    integration_allowed: body.integration_allowed === true,
    production_integration_intent_recorded: body.production_integration_intent_recorded === true,
    merge_allowed: body.merge_allowed === true,
    deploy_allowed: body.deploy_allowed === true,
    pr_allowed: body.pr_allowed === true,
    production_mutation_allowed: body.production_mutation_allowed === true,
    requested_integration_intent: typeof body.requested_integration_intent === "string"
      ? body.requested_integration_intent
      : "",
    safety_constraints: Array.isArray(body.safety_constraints) ? body.safety_constraints.filter(isString) : [],
    user_note: typeof body.user_note === "string" ? body.user_note : undefined,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
