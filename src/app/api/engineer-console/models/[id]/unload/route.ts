import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { unloadModel } from "@/lib/engineer-console/model-control/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeModelApi(request, "write");
  if (auth !== true) return auth;
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { idleGraceSeconds?: number; force?: boolean };
    const model = await unloadModel(decodeURIComponent(id), {
      idleGraceSeconds: body.idleGraceSeconds ?? 0,
      force: body.force === true,
    });
    return NextResponse.json({ model });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
