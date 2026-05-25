import { NextResponse } from "next/server";
import { executeRun } from "@/lib/engineer-console/orchestrator/run-orchestrator";
import { createRun, listRunsForTask } from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById, updateTask } from "@/lib/engineer-console/task-manager/task-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
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
  const task = getTaskById(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ runs: listRunsForTask(id) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const task = getTaskById(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const run = createRun(id);
  updateTask(id, { status: "queued" });

  void executeRun(run.id).catch((error) => {
    console.error(`Run ${run.id} failed:`, error);
  });

  return NextResponse.json({ run }, { status: 201 });
}
