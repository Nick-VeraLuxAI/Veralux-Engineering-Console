import { NextResponse } from "next/server";
import {
  createMergeRequest,
  listMergeRequestsForRun,
  toPublicMergeRequest,
} from "@/lib/engineer-console/release/merge-controls/merge-request-manager";
import { MergeControlError } from "@/lib/engineer-console/release/merge-controls/merge-control-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const requests = listMergeRequestsForRun(id).map(toPublicMergeRequest);
  return NextResponse.json({ requests });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "admin" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    prRequestId?: string;
    mergeMethod?: "squash" | "merge";
    rationale?: string;
    actorLabel?: string;
  };

  if (!body.prRequestId?.trim()) {
    return NextResponse.json({ error: "prRequestId is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = await createMergeRequest({
      runId: id,
      prRequestId: body.prRequestId.trim(),
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      mergeMethod: body.mergeMethod,
      rationale: body.rationale,
    });
    return NextResponse.json({ ok: true, request: toPublicMergeRequest(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof MergeControlError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
