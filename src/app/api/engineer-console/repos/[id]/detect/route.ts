import { NextResponse } from "next/server";
import {
  refreshRepoDetection,
  toPublicRegisteredRepo,
} from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import { RegisteredRepoError } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  try {
    const repo = await refreshRepoDetection(id);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }
    return NextResponse.json({ repo: toPublicRegisteredRepo(repo) });
  } catch (error) {
    if (error instanceof RegisteredRepoError && error.message.includes("not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Detect repo metadata error:", error);
    return NextResponse.json({ error: "Failed to detect repository metadata" }, { status: 500 });
  }
}
