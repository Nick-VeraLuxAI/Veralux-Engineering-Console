import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { routeChatCompletion } from "@/lib/engineer-console/model-control/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

/** OpenAI-compatible chat endpoint: routes by `model` to the chosen workstation model,
 *  auto-loading console-managed models on demand. Streams pass through unchanged. */
export async function POST(request: Request) {
  const auth = await authorizeModelApi(request, "write");
  if (auth !== true) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, { status: 400 });
  }
  try {
    const routed = await routeChatCompletion(body, request.signal);
    const headers = new Headers(routed.upstream.headers);
    headers.set("x-veralux-routed-model", routed.model.id);
    if (routed.autoLoaded) headers.set("x-veralux-auto-loaded-seconds", String(routed.loadSeconds ?? ""));
    headers.set("cache-control", "no-store");
    return new Response(routed.upstream.body, { status: routed.upstream.status, headers });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
