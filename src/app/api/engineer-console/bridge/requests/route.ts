import { NextResponse } from "next/server";
import {
  BridgeRepoResolutionError,
  BridgeRequestValidationError,
  createEngineeringRequestFromVeraluxOsBridge,
  parseVeraluxOsBridgeCreateRequestBody,
} from "@/lib/engineer-console/bridge/create-engineering-request";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { RegisteredRepoError } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const body = parseVeraluxOsBridgeCreateRequestBody(raw);
    const origin = new URL(request.url).origin;
    const result = createEngineeringRequestFromVeraluxOsBridge(body, { consoleOrigin: origin });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BridgeRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BridgeRepoResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RegisteredRepoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
