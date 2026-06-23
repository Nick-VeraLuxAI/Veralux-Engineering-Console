import { NextResponse } from "next/server";
import {
  runPrototypeLoopRevision,
  type PrototypeLoopRevisionRequest,
} from "@/lib/engineer-console/prototype-loop/prototype-loop-revision";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  const result = await runPrototypeLoopRevision(normalizeRequest(body));

  return NextResponse.json(
    result,
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request): Promise<Partial<PrototypeLoopRevisionRequest>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Partial<PrototypeLoopRevisionRequest> : {};
  } catch {
    return {};
  }
}

function normalizeRequest(body: Partial<PrototypeLoopRevisionRequest>): PrototypeLoopRevisionRequest {
  const revision = body.revision_request ?? {};
  return {
    parent_task_id: typeof body.parent_task_id === "string" ? body.parent_task_id : "",
    parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : "",
    parent_evidence_path: typeof body.parent_evidence_path === "string" ? body.parent_evidence_path : "",
    revision_request: {
      reason: typeof revision.reason === "string" ? revision.reason : "",
      failed_gates: Array.isArray(revision.failed_gates) ? revision.failed_gates.filter(isString) : [],
      acceptance_criteria_not_met: Array.isArray(revision.acceptance_criteria_not_met)
        ? revision.acceptance_criteria_not_met.filter(isString)
        : [],
      requested_changes: Array.isArray(revision.requested_changes) ? revision.requested_changes.filter(isString) : [],
      safety_notes: Array.isArray(revision.safety_notes) ? revision.safety_notes.filter(isString) : [],
    },
    max_revision_rounds: typeof body.max_revision_rounds === "number" ? body.max_revision_rounds : 0,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
