/** Durable VeraLux ↔ S13 correlation store (atomic JSON files). */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { SeniorCorrelationRecord } from "./types";

function utcNow(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmp, filePath);
}

export class SeniorCorrelationStore {
  readonly root: string;

  constructor(root: string) {
    if (root.includes("/mnt/large-storage")) {
      throw new Error("rejected_large_storage_path");
    }
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private recordPath(veraRequestId: string): string {
    return path.join(this.root, "correlations", `${veraRequestId}.json`);
  }

  write(record: SeniorCorrelationRecord): SeniorCorrelationRecord {
    const next = { ...record, updatedAt: utcNow() };
    atomicWriteJson(this.recordPath(record.veraRequestId), next);
    return next;
  }

  read(veraRequestId: string): SeniorCorrelationRecord | null {
    const p = this.recordPath(veraRequestId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as SeniorCorrelationRecord;
  }

  list(): SeniorCorrelationRecord[] {
    const dir = path.join(this.root, "correlations");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as SeniorCorrelationRecord);
  }

  listNonterminal(): SeniorCorrelationRecord[] {
    const terminal = new Set([
      "senior_completed",
      "senior_cancelled",
      "senior_failed",
      "senior_decision_blocked",
    ]);
    return this.list().filter((r) => !terminal.has(r.state));
  }

  findByS13RequestId(s13RequestId: string): SeniorCorrelationRecord | null {
    return this.list().find((r) => r.s13RequestId === s13RequestId) ?? null;
  }

  writeDecision(veraRequestId: string, decision: unknown): void {
    atomicWriteJson(path.join(this.root, "routing-decisions", `${veraRequestId}.json`), {
      veraRequestId,
      decision,
      writtenAt: utcNow(),
    });
  }

  writeApproval(approvalReference: string, artifact: unknown): void {
    atomicWriteJson(path.join(this.root, "approval-artifacts", `${approvalReference}.json`), artifact);
  }
}
