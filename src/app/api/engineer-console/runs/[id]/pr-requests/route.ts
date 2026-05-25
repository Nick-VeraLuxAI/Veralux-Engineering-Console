import { NextResponse } from "next/server";
import { evaluatePrReadiness } from "@/lib/engineer-console/release/pr-creation/evaluate-pr-readiness";
import {
  createPrRequest,
  listPrRequestsForRun,
  toPublicPrRequest,
} from "@/lib/engineer-console/release/pr-creation/pr-request-manager";
import { PrCreationError } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
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

  const requests = listPrRequestsForRun(id).map(toPublicPrRequest);
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
    actorLabel?: string;
    baseBranch?: string;
    draft?: boolean;
    rationale?: string;
  };

  const readiness = await evaluatePrReadiness(id);
  if (readiness.status === "blocked") {
    return NextResponse.json(
      { error: readiness.blockers[0] ?? "PR creation blocked", readiness },
      { status: 400 },
    );
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = await createPrRequest({
      runId: id,
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      baseBranch: body.baseBranch,
      draft: body.draft,
      rationale: body.rationale,
    });
    return NextResponse.json({ ok: true, request: toPublicPrRequest(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PrCreationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
