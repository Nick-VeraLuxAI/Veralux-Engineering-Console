import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import { answerClarificationAndResume } from "@/lib/engineer-console/autonomous-engineer/clarification";
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

  let body: { answer?: string };
  try {
    body = (await request.json()) as { answer?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body.answer?.trim()) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator);
    const result = await answerClarificationAndResume({
      runId: id,
      answer: body.answer,
      actorLabel: actor.actorLabel,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resume";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
