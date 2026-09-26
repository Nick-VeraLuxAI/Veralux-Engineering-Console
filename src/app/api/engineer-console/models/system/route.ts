import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { getSystemSnapshot } from "@/lib/engineer-console/model-control/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeModelApi(request, "read");
  if (auth !== true) return auth;
  try {
    return NextResponse.json(await getSystemSnapshot());
  } catch (error) {
    return modelErrorResponse(error);
  }
}
