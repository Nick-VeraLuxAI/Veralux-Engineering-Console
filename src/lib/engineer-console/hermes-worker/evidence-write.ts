import fs from "fs";
import path from "path";
import type { HermesRunPacketV1 } from "./hermes-run-packet-types";

export function writeEvidenceReport(
  reportPath: string,
  report: Record<string, unknown>,
  packet: HermesRunPacketV1,
): void {
  const evidenceDir = path.dirname(path.resolve(packet.evidence.placeholderPath));
  const resolved = path.resolve(reportPath);
  const relative = path.relative(evidenceDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evidence report must stay within evidence directory");
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
