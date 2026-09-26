import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import { getAutonomousCompletionPackage } from "@/lib/engineer-console/autonomous-engineer/completion-package";
import { isAutonomousRun } from "@/lib/engineer-console/autonomous-engineer/state-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!isAutonomousRun(id)) {
    return NextResponse.json({ error: "Not an autonomous engineer run" }, { status: 404 });
  }
  const completionPackage = getAutonomousCompletionPackage(id);
  return NextResponse.json({ completionPackage });
}
