import { NextResponse } from "next/server";
import { listMapChatModels, parseMapChatRequest, runMapChat } from "@/lib/engineer-console/dashboard/map-chat";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(await listMapChatModels());
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON body is required" }, { status: 400 });
  }

  try {
    const parsed = parseMapChatRequest(body);
    const turn = await runMapChat(parsed);
    return NextResponse.json(turn);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Map chat failed";
    const status = /required|must be/.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
