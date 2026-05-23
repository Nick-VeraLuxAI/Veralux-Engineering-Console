import { NextResponse } from "next/server";
import { AUDIT_ACTOR_TYPES } from "@/lib/engineer-console/governance/audit-ledger/audit-event-types";
import { evaluatePrReadiness } from "@/lib/engineer-console/release/pr-creation/evaluate-pr-readiness";
import {
  createPrRequest,
  listPrRequestsForRun,
  toPublicPrRequest,
} from "@/lib/engineer-console/release/pr-creation/pr-request-manager";
import { PrCreationError } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
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
    const record = await createPrRequest({
      runId: id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: body.actorLabel ?? "operator",
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
