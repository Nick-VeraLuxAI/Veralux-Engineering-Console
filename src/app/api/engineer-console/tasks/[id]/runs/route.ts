import { NextResponse } from "next/server";
import { executeRun } from "@/lib/engineer-console/orchestrator/run-orchestrator";
import { createRun, listRunsForTask } from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById, updateTask } from "@/lib/engineer-console/task-manager/task-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import { createAutonomousState } from "@/lib/engineer-console/autonomous-engineer/state-store";

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

  let body: {
    mode?: string;
    objective?: string;
    acceptanceCriteria?: string[];
    constraints?: string[];
    authorizedPathPrefixes?: string[];
  } = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const autonomous = body.mode === "autonomous";
  const run = createRun(id, autonomous ? "autonomous_engineer" : "engineer");
  updateTask(id, { status: "queued" });

  if (autonomous) {
    createAutonomousState({
      runId: run.id,
      task,
      objective: (body.objective ?? task.description ?? task.title).trim(),
      acceptanceCriteria: body.acceptanceCriteria,
      constraints: body.constraints,
      authorizedPathPrefixes: body.authorizedPathPrefixes,
    });
  }

  void executeRun(run.id).catch((error) => {
    console.error(`Run ${run.id} failed:`, error);
  });

  return NextResponse.json({ run, autonomous }, { status: 201 });
}
