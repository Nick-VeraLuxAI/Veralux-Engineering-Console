import { NextResponse } from "next/server";
import {
  buildReleaseChecklist,
} from "@/lib/engineer-console/release/release-checklist/build-release-checklist";
import {
  getLatestReleaseChecklistForRun,
  listReleaseChecklistsForRun,
  parseReleaseChecklistEvaluation,
  runReleaseChecklistEvaluation,
  toPublicReleaseChecklist,
} from "@/lib/engineer-console/release/release-checklist/release-checklist-manager";
import { ReleaseChecklistError } from "@/lib/engineer-console/release/release-checklist/release-checklist-types";
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

  const latestRecord = getLatestReleaseChecklistForRun(id);
  const computed = buildReleaseChecklist(id);
  const history = listReleaseChecklistsForRun(id).map((record) =>
    toPublicReleaseChecklist(parseReleaseChecklistEvaluation(record), {
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }),
  );

  const latest = latestRecord
    ? toPublicReleaseChecklist(parseReleaseChecklistEvaluation(latestRecord), {
        id: latestRecord.id,
        createdAt: latestRecord.createdAt,
        updatedAt: latestRecord.updatedAt,
      })
    : null;

  return NextResponse.json({
    latest,
    computed: toPublicReleaseChecklist(computed),
    history,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { actorLabel?: string };

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const evaluation = await runReleaseChecklistEvaluation(id, {
      persist: true,
      audit: true,
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      refreshEvidence: false,
    });
    const record = getLatestReleaseChecklistForRun(id)!;
    return NextResponse.json({
      ok: true,
      checklist: toPublicReleaseChecklist(evaluation, {
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReleaseChecklistError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
