import { NextResponse } from "next/server";
import {
  runPrototypeImplementationPlanningV1,
  type PrototypeImplementationPlanningRequest,
} from "@/lib/engineer-console/prototype-loop/prototype-implementation-planning";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  const result = await runPrototypeImplementationPlanningV1(normalizeRequest(body));

  return NextResponse.json(
    result,
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request): Promise<Partial<PrototypeImplementationPlanningRequest>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Partial<PrototypeImplementationPlanningRequest> : {};
  } catch {
    return {};
  }
}

function normalizeRequest(body: Partial<PrototypeImplementationPlanningRequest>): PrototypeImplementationPlanningRequest {
  return {
    implementation_request_id: typeof body.implementation_request_id === "string" ? body.implementation_request_id : "",
    approval_decision_id: typeof body.approval_decision_id === "string" ? body.approval_decision_id : "",
    task_id: typeof body.task_id === "string" ? body.task_id : "",
    run_id: typeof body.run_id === "string" ? body.run_id : "",
    evidence_path: typeof body.evidence_path === "string" ? body.evidence_path : "",
    revision_task_id: typeof body.revision_task_id === "string" ? body.revision_task_id : undefined,
    revision_run_id: typeof body.revision_run_id === "string" ? body.revision_run_id : undefined,
    revision_evidence_path: typeof body.revision_evidence_path === "string" ? body.revision_evidence_path : undefined,
    final_readiness_status: typeof body.final_readiness_status === "string" ? body.final_readiness_status : "",
    requested_implementation_intent: typeof body.requested_implementation_intent === "string"
      ? body.requested_implementation_intent
      : "",
    production_mutation_allowed: body.production_mutation_allowed === true,
    safety_constraints: Array.isArray(body.safety_constraints) ? body.safety_constraints.filter(isString) : [],
    user_note: typeof body.user_note === "string" ? body.user_note : undefined,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
