import { NextResponse } from "next/server";
import {
  createReleaseSignoff,
  listReleaseSignoffsForRun,
  ReleaseSignoffError,
  toPublicReleaseSignoff,
} from "@/lib/engineer-console/release/release-signoff/release-signoff-manager";
import { RELEASE_SIGNOFF_DECISIONS } from "@/lib/engineer-console/release/release-signoff/release-signoff-types";
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

  const history = listReleaseSignoffsForRun(id).map(toPublicReleaseSignoff);
  return NextResponse.json({ history, latest: history[0] ?? null });
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

  const body = (await request.json().catch(() => ({}))) as {
    decision?: string;
    rationale?: string;
    actorLabel?: string;
  };

  const decision = body.decision?.trim();
  if (!decision || !RELEASE_SIGNOFF_DECISIONS.includes(decision as (typeof RELEASE_SIGNOFF_DECISIONS)[number])) {
    return NextResponse.json(
      { error: "decision must be completed, completed_with_exceptions, or rejected" },
      { status: 400 },
    );
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = createReleaseSignoff({
      runId: id,
      decision: decision as (typeof RELEASE_SIGNOFF_DECISIONS)[number],
      rationale: body.rationale,
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
    });
    return NextResponse.json({
      ok: true,
      signoff: toPublicReleaseSignoff(record),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReleaseSignoffError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
