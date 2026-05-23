import { NextResponse } from "next/server";
import { RegisteredRepoError } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import { createTask, listTasks } from "@/lib/engineer-console/task-manager/task-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import type { TaskPriority } from "@/lib/engineer-console/types";

export const runtime = "nodejs";

export async function GET() {
  ensureEngineerConsoleReady();
  return NextResponse.json({ tasks: listTasks() });
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    targetRepoPath?: string;
    registeredRepoId?: string;
    priority?: TaskPriority;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  if (!body.registeredRepoId?.trim() && !body.targetRepoPath?.trim()) {
    return NextResponse.json(
      { error: "registeredRepoId or targetRepoPath is required" },
      { status: 400 },
    );
  }

  try {
    const task = createTask({
      title: body.title.trim(),
      description: body.description?.trim() ?? "",
      targetRepoPath: body.targetRepoPath?.trim(),
      registeredRepoId: body.registeredRepoId?.trim(),
      priority: body.priority ?? "normal",
      status: "draft",
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof RegisteredRepoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
