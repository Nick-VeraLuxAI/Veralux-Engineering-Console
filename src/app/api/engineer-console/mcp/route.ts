import { NextResponse } from "next/server";
import { authorizeModelApi } from "@/lib/engineer-console/model-control/auth";
import { handleMcpMessage } from "@/lib/engineer-console/model-control/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  const auth = await authorizeModelApi(request, "write");
  if (auth !== true) return auth;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(payload) ? payload : [payload];
  const responses = (await Promise.all(messages.map((m) => handleMcpMessage(m)))).filter(Boolean);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(payload) ? responses : responses[0]);
}

export async function GET() {
  return new Response("SSE stream not supported; use POST", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 200 });
}
