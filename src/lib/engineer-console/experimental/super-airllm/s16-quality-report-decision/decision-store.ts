/** Durable S16 decision-context store with atomic writes. */

import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import type { QualityReportDecisionContext } from "./types";

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmp, filePath);
}

export class DecisionContextStore {
  readonly root: string;

  constructor(stateRoot: string) {
    this.root = path.join(stateRoot, "decision-contexts");
    mkdirSync(this.root, { recursive: true });
  }

  private fileFor(id: string): string {
    return path.join(this.root, `${id}.json`);
  }

  write(context: QualityReportDecisionContext): QualityReportDecisionContext {
    const next = { ...context, updatedAt: utcNow() };
    atomicWriteJson(this.fileFor(next.decisionContextId), next);
    return next;
  }

  read(decisionContextId: string): QualityReportDecisionContext | null {
    const file = this.fileFor(decisionContextId);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as QualityReportDecisionContext;
  }

  require(decisionContextId: string): QualityReportDecisionContext {
    const ctx = this.read(decisionContextId);
    if (!ctx) throw new Error(`decision_context_not_found:${decisionContextId}`);
    return ctx;
  }

  list(): QualityReportDecisionContext[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(path.join(this.root, n), "utf8")) as QualityReportDecisionContext);
  }

  findByRunId(runId: string): QualityReportDecisionContext | null {
    return this.list().find((c) => c.runId === runId && c.state !== "stale") ?? null;
  }

  appendEvent(decisionContextId: string, event: Record<string, unknown>): void {
    const eventsPath = path.join(this.root, `${decisionContextId}.events.jsonl`);
    mkdirSync(path.dirname(eventsPath), { recursive: true });
    writeFileSync(eventsPath, JSON.stringify({ ...event, timestamp: utcNow() }) + "\n", {
      flag: "a",
      encoding: "utf8",
    });
  }
}
