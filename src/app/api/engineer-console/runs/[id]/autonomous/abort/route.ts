import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import { abortAutonomousRun } from "@/lib/engineer-console/autonomous-engineer/start-autonomous-run";
import { isAutonomousRun } from "@/lib/engineer-console/autonomous-engineer/state-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!isAutonomousRun(id)) {
    return NextResponse.json({ error: "Not an autonomous engineer run" }, { status: 404 });
  }

  let body: { reason?: string };
  try {
    body = (await request.json()) as { reason?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator);
    abortAutonomousRun(id, { reason: body.reason.trim(), actorLabel: actor.actorLabel });
    return NextResponse.json({ ok: true, status: "aborted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to abort";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
