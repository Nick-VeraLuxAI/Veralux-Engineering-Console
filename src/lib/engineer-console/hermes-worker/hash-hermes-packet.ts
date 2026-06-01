import { createHash } from "crypto";
import type { HermesRunPacketV1 } from "./hermes-run-packet-types";

export function hashHermesRunPacket(packet: HermesRunPacketV1): string {
  const canonical = JSON.stringify(packet);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
