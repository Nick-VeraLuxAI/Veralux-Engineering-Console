import fs from "fs";
import path from "path";

/** Default integration modules for Memory-Module facade/orchestration missions. */
export const MEMORY_MODULE_INTEGRATION_PATHS = [
  "src/contracts.ts",
  "src/write-pipeline.ts",
  "src/retrieval-engine.ts",
  "src/explain.ts",
  "src/context-budget-assembler.ts",
  "src/event-log.ts",
  "src/memory-record-store.ts",
] as const;

const INTEGRATION_OBJECTIVE_RE =
  /\b(MemoryService|facade|orchestrat|end-to-end|e2e|unify|wire\s+into|uses\s+write-pipeline|uses\s+retrieval|recall\(|proposeAndCommit)\b/i;

export function objectiveNeedsIntegrationGrounding(input: {
  objective?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
}): boolean {
  const haystack = [
    input.objective ?? "",
    ...(input.requirements ?? []),
    ...(input.acceptanceCriteria ?? []),
  ].join("\n");
  return INTEGRATION_OBJECTIVE_RE.test(haystack);
}

/** Extract export signatures (functions, classes, key types) for planner crib sheets. */
export function extractExportSignatures(source: string): string[] {
  const lines: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+\w+[^{;]+/g,
    /export\s+class\s+\w+[^{]+/g,
    /export\s+interface\s+\w+[^{]+/g,
    /export\s+type\s+\w+\s*=[^;]+/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const line = match[0].replace(/\s+/g, " ").trim();
      if (line.length > 12 && line.length < 280) lines.push(line);
    }
  }
  return [...new Set(lines)];
}

export function readIntegrationModuleSignatures(
  repoPath: string,
  relativePaths: readonly string[],
): Array<{ path: string; signatures: string[] }> {
  const blocks: Array<{ path: string; signatures: string[] }> = [];
  for (const relative of relativePaths) {
    const abs = path.join(repoPath, relative);
    if (!fs.existsSync(abs)) continue;
    try {
      const source = fs.readFileSync(abs, "utf8");
      const signatures = extractExportSignatures(source);
      if (signatures.length > 0) blocks.push({ path: relative, signatures });
    } catch {
      // skip unreadable
    }
  }
  return blocks;
}

export function isMemoryModuleProject(repoPath: string): boolean {
  if (repoPath.toLowerCase().includes("memory-module")) return true;
  try {
    const pkgPath = path.join(repoPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg.name === "string" && pkg.name.toLowerCase().includes("memory-module")) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/** Canonical Memory-Module API cheat sheet — prevents invented signatures at integration time. */
export const MEMORY_MODULE_API_CRIB = `
Memory-Module integration API (call EXACTLY — do not invent async wrappers or alternate signatures):
Module import paths:
- from "./contracts.js": EventLog, MemoryRecordStore, MemoryEvent, MemoryRecord, MemoryScope, MemoryRecordKind, MemoryClass, RetrievalQuery, AssembledContext, MemoryProposal, RetrievalFeedback, FeedbackLog
- from "./explain.js": explainMemory(recordId: string, store: MemoryRecordStore, eventLog: EventLog): ExplainResult, ExplainResult
- from "./write-pipeline.js": buildMemoryProposal(event: MemoryEvent, candidates?: readonly MemoryClass[]): MemoryProposal, commitProposal(store: MemoryRecordStore, proposal: MemoryProposal): MemoryRecord, shouldIgnoreEvent(event: MemoryEvent): boolean
- from "./retrieval-engine.js": hybridRetrieve(query: RetrievalQuery, records: MemoryRecord[], events: MemoryEvent[]): RankedCandidate[]
- from "./context-budget-assembler.js": BudgetedContextAssembler (class with instance method .assemble(query, records, events): AssembledContext)
- from "./feedback-log.js": InMemoryFeedbackLog

FeedbackLog implementation (src/feedback-log.ts):
- import type { FeedbackLog, RetrievalFeedback } from "./contracts.js";
- export class InMemoryFeedbackLog implements FeedbackLog {
    private readonly items: RetrievalFeedback[] = [];
    append(feedback: RetrievalFeedback): RetrievalFeedback { this.items.push(feedback); return feedback; }
    list(): RetrievalFeedback[] { return [...this.items]; }
  }

MemoryService implementation:
- Direct export only: 'export class MemoryService { ... }' — DO NOT add 'export { MemoryService };' at bottom (causes TS2323/TS2484 duplicate export error).
- Import all types from "./contracts.js" including MemoryEvent, MemoryRecord, MemoryClass, MemoryProposal, AssembledContext, RetrievalQuery, RetrievalFeedback, FeedbackLog.
- constructor(eventLog: EventLog, recordStore: MemoryRecordStore, options?: { feedbackLog?: FeedbackLog } & Record<string, unknown>)
- appendEvent(event: MemoryEvent): MemoryEvent -> delegates to eventLog.append(event)
- proposeAndCommit(event: MemoryEvent, candidates?: readonly MemoryClass[]): MemoryRecord | null -> shouldIgnoreEvent(event) ? null : commitProposal(this.recordStore, buildMemoryProposal(event, candidates ?? []))
- recall(query: RetrievalQuery): AssembledContext -> calls hybridRetrieve(query, this.recordStore.list(), this.eventLog.list()) and returns new BudgetedContextAssembler().assemble(query, this.recordStore.list(), this.eventLog.list()); if feedbackLog is present, logs RetrievalFeedback
- explain(recordId: string): ExplainResult -> explainMemory(recordId, this.recordStore, this.eventLog)

In src/index.ts:
- Re-export types from contracts.js: export type { EventLog, MemoryRecordStore, MemoryEvent, MemoryRecord, MemoryScope, MemoryRecordKind, MemoryClass, RetrievalQuery, AssembledContext, MemoryProposal, RetrievalFeedback, FeedbackLog } from "./contracts.js";
- Re-export implementations from their modules: export { InMemoryEventLog } from "./event-log.js"; export { InMemoryMemoryRecordStore } from "./memory-record-store.js"; export { InMemoryFeedbackLog } from "./feedback-log.js"; export { MemoryService } from "./memory-service.js";

In src/memory-service.test.ts:
- Import describe, it, expect from "vitest" (NOT "./vitest").
- Fixtures: create an event with { id: "evt-1", occurredAt: new Date().toISOString(), scope: { projectId: "p1" }, type: "user_action", content: "first event", metadata: {} }
- End-to-end test flow: appendEvent -> proposeAndCommit (save returned record) -> assert expect(record).not.toBeNull() and use if (record) { ... } before record.id so TypeScript knows record is not null -> recall -> explain(record.id)
`.trim();

export function buildIntegrationGroundingBlock(
  repoPath: string,
  input: {
    objective?: string;
    requirements?: string[];
    acceptanceCriteria?: string[];
    extraCrib?: string;
    modulePaths?: readonly string[];
  },
): string {
  if (
    !objectiveNeedsIntegrationGrounding(input)
    && !input.extraCrib
    && !input.modulePaths?.length
  ) {
    return "";
  }

  const paths = input.modulePaths ?? MEMORY_MODULE_INTEGRATION_PATHS;
  const blocks = readIntegrationModuleSignatures(repoPath, paths);
  const signatureSection =
    blocks.length === 0
      ? ""
      : blocks
          .map(
            (block) =>
              `${block.path}:\n${block.signatures.map((signature) => `  ${signature}`).join("\n")}`,
          )
          .join("\n\n");

  const isMemoryModule = isMemoryModuleProject(repoPath) || objectiveNeedsIntegrationGrounding(input);
  const parts = [
    "INTEGRATION MODE — compose existing modules using exact signatures below. Do not invent methods, async variants, or partial argument lists.",
    isMemoryModule ? MEMORY_MODULE_API_CRIB : "",
    input.extraCrib ?? "",
    signatureSection ? `Live export signatures from repo:\n${signatureSection}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}
