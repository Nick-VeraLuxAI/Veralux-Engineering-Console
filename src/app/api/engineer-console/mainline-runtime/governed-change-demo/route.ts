import { NextResponse } from "next/server";
import {
  MainlineGovernedChangeDemoError,
  runMainlineGovernedChangeDemo,
} from "@/lib/engineer-console/mainline-runtime/mainline-governed-change-demo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

interface GovernedChangeDemoRequestBody {
  request?: string;
  docPath?: string;
  evidencePath?: string;
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  try {
    const proof = await runMainlineGovernedChangeDemo({
      request: stringField(body, "request"),
      docPath: stringField(body, "docPath"),
      evidencePath: stringField(body, "evidencePath"),
    });

    return NextResponse.json(
      {
        status: "governed_code_change_api_ui_trigger_passed_awaiting_user_approval",
        proof,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MainlineGovernedChangeDemoError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }
    throw error;
  }
}

async function readBody(request: Request): Promise<GovernedChangeDemoRequestBody> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as GovernedChangeDemoRequestBody : {};
  } catch {
    return {};
  }
}

function stringField(
  body: GovernedChangeDemoRequestBody,
  key: keyof GovernedChangeDemoRequestBody,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
