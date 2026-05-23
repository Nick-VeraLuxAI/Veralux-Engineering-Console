import { NextResponse } from "next/server";
import {
  verifyAuditChainForRun,
  verifyAuditChainForScope,
} from "@/lib/engineer-console/governance/audit-ledger/audit-ledger-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (runId) {
    const verification = verifyAuditChainForRun(runId);
    return NextResponse.json({ runId, ...verification });
  }

  const verification = verifyAuditChainForScope();
  return NextResponse.json({ scope: "global", ...verification });
}
