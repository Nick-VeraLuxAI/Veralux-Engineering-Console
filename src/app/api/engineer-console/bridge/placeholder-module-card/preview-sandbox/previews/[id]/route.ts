import { NextResponse } from "next/server";
import { getVeraPreviewSandboxSnapshot } from "@/lib/engineer-console/bridge/placeholder-module-card-preview-sandbox";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id)) {
    return NextResponse.json({ error: "Invalid preview id" }, { status: 404 });
  }
  const snapshot = getVeraPreviewSandboxSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ error: "Preview not found or expired" }, { status: 404 });
  }
  return new NextResponse(snapshot.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
