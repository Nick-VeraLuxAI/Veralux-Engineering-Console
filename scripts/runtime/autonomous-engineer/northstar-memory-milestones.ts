/**
 * Memory Module northstar — bounded AE objectives in dependency order.
 * Each milestone must reach waiting_for_approval with QC green on the host scaffold.
 */

export type NorthstarMilestone = {
  id: string;
  title: string;
  objective: string;
  authorizedPathPrefixes: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  maxIterations?: number;
};

export const NORTHSTAR_MEMORY_MILESTONES: NorthstarMilestone[] = [
  {
    id: "m01-memory-taxonomy",
    title: "Five-class memory taxonomy",
    objective: `Extend the Memory Module V0 scaffold with the five northstar memory classes (additive only).

Required:
- In src/contracts.ts ADD export type MemoryClass = "working" | "episodic" | "semantic" | "procedural" | "constraint".
- ADD optional memoryClass?: MemoryClass to MemoryRecord (keep kind, supersededById, and all existing fields unchanged).
- ADD comment mapping legacy kind → class: durable/summary→semantic, transient→working.
- Update InMemoryMemoryRecordStore: when memoryClass omitted on upsert, infer from kind using that mapping; persist memoryClass on the stored record.
- Add src/memory-class.test.ts (import from ./memory-record-store.js and ./contracts.js) proving each class round-trips.
- Export MemoryClass from src/index.ts.

FORBIDDEN:
- Do not rename kind to memoryRecordKind or remove any existing MemoryRecord / MemoryRecordStore fields.
- Do not rewrite unrelated interfaces (MemoryEvent, EventLog, ContextAssembler stay structurally the same).

Constraints:
- npm test and npm run typecheck must pass including ALL existing tests without weakening them.`,
    authorizedPathPrefixes: ["src/"],
    constraints: [
      "Do not create PR, merge, or deploy.",
      "Do not delete existing exports from src/contracts.ts.",
      "Keep all existing tests green.",
    ],
    acceptanceCriteria: [
      "MemoryClass enum with five values exists",
      "MemoryRecord includes memoryClass",
      "Store round-trips memoryClass",
      "New vitest covers all five classes",
    ],
  },
  {
    id: "m02-governed-write-pipeline",
    title: "Governed memory write pipeline",
    objective: `Add model-agnostic governed write pipeline: events → proposal → commit.

Required:
- src/write-pipeline.ts with:
  - shouldIgnoreEvent(event): boolean — deterministic rules (ignore empty content, type "progress", type "greeting").
  - buildMemoryProposal(event, candidates): MemoryProposal — pure data struct, no fetch.
  - commitProposal(store, proposal): MemoryRecord — commits only when proposal.confidence >= 0.5 and statement non-empty.
- src/contracts.ts: MemoryProposal type (statement, memoryClass, scope, provenanceEventIds, confidence, kind).
- src/write-pipeline.test.ts covering ignore rules, reject low confidence, successful commit.
- Export from src/index.ts.

Do not call any LLM. Do not modify contracts.ts export names already public.`,
    authorizedPathPrefixes: ["src/"],
    constraints: [
      "No network calls or model invocations in write-pipeline.ts.",
      "Keep existing tests green.",
    ],
    acceptanceCriteria: [
      "Deterministic event filters",
      "MemoryProposal type in contracts",
      "commitProposal gated by confidence threshold",
      "Tests pass",
    ],
  },
  {
    id: "m03-explain-provenance",
    title: "explain() provenance chain",
    objective: `Add evidence-backed explain for memory records.

Required:
- src/explain.ts with explainMemory(recordId, store, eventLog): ExplainResult
- ExplainResult: recordId, statement, memoryClass, chain: Array<{ kind: "record"|"event"; id; summary }>
- Walk provenanceEventIds into event log; include supersededById if set.
- src/explain.test.ts with fixture event+record chain.
- Export explainMemory from src/index.ts.`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["Keep existing tests green.", "No model calls."],
    acceptanceCriteria: [
      "explainMemory returns provenance chain",
      "Events resolved from event log",
      "Tests pass",
    ],
  },
  {
    id: "m04-token-budget-assembler",
    title: "Token budget context assembly",
    objective: `Upgrade context assembly with explicit northstar token buckets.

Required:
- src/context-budget.ts: DEFAULT_CONTEXT_BUDGET = { governance: 512, task: 768, memory: 1536, history: 1024 } (token estimates).
- Extend InMemoryContextAssembler OR add BudgetedContextAssembler in src/context-budget-assembler.ts that:
  - Respects RetrievalQuery.maxTokens as total cap
  - Fills memory bucket first from records, then history from events
  - Sets truncated: boolean when content clipped
- src/context-budget-assembler.test.ts proves cap enforced (estimatedTokens <= maxTokens).
- Export from src/index.ts.`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["Keep InMemoryContextAssembler working (may delegate or coexist).", "Existing tests green."],
    acceptanceCriteria: ["Budget buckets defined", "Assembler respects maxTokens", "Tests pass"],
  },
  {
    id: "m05-hybrid-retrieval",
    title: "Hybrid retrieval engine",
    objective: `Add hybrid retrieval: lexical + recency + scope (no vectors yet).

Required:
- src/retrieval-engine.ts: hybridRetrieve(query, records, events): RankedCandidate[]
- RankedCandidate: { source: "record"|"event"; id; score; summary; reasons: string[] }
- Scoring: lexical match on query (+0.4), scope exact match (+0.2), recency by occurredAt/updatedAt (+0.2), importance via confidence (+0.2)
- src/retrieval-engine.test.ts: query finds correct record among decoys; scope filters contamination.
- Export hybridRetrieve from src/index.ts.`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["No embedding/vector dependencies.", "Existing tests green."],
    acceptanceCriteria: ["Hybrid scoring with explain reasons", "Scope isolation in tests", "Tests pass"],
  },
  {
    id: "m06-consolidation",
    title: "Episodic consolidation",
    objective: `Add episodic → semantic consolidation (deterministic V0).

Required:
- src/consolidation.ts: consolidateEpisodicEvents(events, scope): MemoryRecordWriteInput | null
  - When >=3 events share scope.projectId and types include "qc_failure" or "attempt", emit one semantic summary statement listing failure class pattern.
  - Pure function, no LLM.
- src/consolidation.test.ts with scripted attempt sequence.
- Export from src/index.ts.`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["No model calls.", "Existing tests green."],
    acceptanceCriteria: ["Consolidation produces semantic record input", "Tests pass"],
  },
  {
    id: "m07-memory-service-facade",
    title: "Memory service facade",
    objective: `Unify subsystems behind a model-agnostic MemoryService facade.

Required:
- src/memory-service.ts class MemoryService with:
  - constructor(eventLog: EventLog, recordStore: MemoryRecordStore, options?)
  - appendEvent(event: MemoryEvent): MemoryEvent → delegates to eventLog.append
  - proposeAndCommit(event: MemoryEvent, candidates?: readonly MemoryClass[]): MemoryRecord | null → shouldIgnoreEvent(event) ? null : commitProposal(this.recordStore, buildMemoryProposal(event, candidates ?? []))
  - recall(query: RetrievalQuery): AssembledContext → calls hybridRetrieve(query, this.recordStore.list(), this.eventLog.list()) and returns new BudgetedContextAssembler().assemble(query, this.recordStore.list(), this.eventLog.list())
  - explain(recordId: string): ExplainResult → explainMemory(recordId, this.recordStore, this.eventLog)
- src/memory-service.test.ts end-to-end: event → commit (save returned record) → assert expect(record).not.toBeNull() and if (record) { ... } → recall → explain(record.id)
- Export MemoryService from src/index.ts

Exact imports required in src/memory-service.ts:
- import type { EventLog, MemoryRecordStore, MemoryEvent, MemoryRecord, MemoryClass, RetrievalQuery, AssembledContext } from "./contracts.js";
- import { shouldIgnoreEvent, buildMemoryProposal, commitProposal } from "./write-pipeline.js";
- import { hybridRetrieve } from "./retrieval-engine.js";
- import { BudgetedContextAssembler } from "./context-budget-assembler.js";
- import { explainMemory, type ExplainResult } from "./explain.js";

API signatures (must match exactly):
- hybridRetrieve(query: RetrievalQuery, records: MemoryRecord[], events: MemoryEvent[]): RankedCandidate[]
- explainMemory(recordId: string, store: MemoryRecordStore, eventLog: EventLog): ExplainResult
- commitProposal(store: MemoryRecordStore, proposal: MemoryProposal): MemoryRecord
- buildMemoryProposal(event: MemoryEvent, candidates?: readonly MemoryClass[]): MemoryProposal
- new BudgetedContextAssembler().assemble(query: RetrievalQuery, records: MemoryRecord[], events: MemoryEvent[]): AssembledContext
- Note: Relative imports must use '.js' extension (e.g. import { EventLog } from "./contracts.js")`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["No HTTP server yet.", "No model calls.", "Existing tests green."],
    acceptanceCriteria: ["MemoryService orchestrates pipeline", "E2E test passes"],
  },
  {
    id: "m08-retrieval-feedback",
    title: "Retrieval feedback logging",
    objective: `Add retrieval feedback loop types and in-memory logger.

Required:
- src/contracts.ts: RetrievalFeedback { query: RetrievalQuery; retrievedIds: string[]; usedIds?: string[]; taskSucceeded?: boolean; at: string; } and FeedbackLog interface { append(feedback: RetrievalFeedback): RetrievalFeedback; list(): RetrievalFeedback[]; }
- src/feedback-log.ts: InMemoryFeedbackLog implementing FeedbackLog (append, list)
- Wire optional feedbackLog (e.g. options?: { feedbackLog?: FeedbackLog }) into MemoryService constructor and MemoryService.recall logging what was retrieved
- src/feedback-log.test.ts testing InMemoryFeedbackLog append/list and MemoryService recall logging
- Export RetrievalFeedback, FeedbackLog, and InMemoryFeedbackLog from src/index.ts.

Constraints:
- Existing tests (including src/memory-service.test.ts) must stay green.
- Note: In MemoryService, use BudgetedContextAssembler from ./context-budget-assembler.js for context assembly.`,
    authorizedPathPrefixes: ["src/"],
    constraints: ["Existing tests green."],
    acceptanceCriteria: ["Feedback logged on recall", "Tests pass"],
  },
  {
    id: "m09-benchmark-harness",
    title: "Memory benchmark harness",
    objective: `Add benchmark/ suite for northstar quality metrics (deterministic cases).

Required:
- benchmark/cases.json — at least 8 cases: should_store, should_ignore, should_supersede, scope_isolation, retrieval_precision, budget_cap, explain_chain, consolidate
- benchmark/run-benchmark.ts — loads cases, runs against MemoryService, outputs JSON scores (pass/fail per case)
- npm run benchmark script in package.json
- benchmark/README.md one paragraph describing metrics

Constraints: benchmark must run without network. Existing src tests stay green.`,
    authorizedPathPrefixes: ["src/", "benchmark/", "package.json"],
    constraints: ["No model in benchmark runner.", "Existing tests green."],
    acceptanceCriteria: ["8+ benchmark cases", "npm run benchmark exits 0 on green scaffold after AE implements prior milestones"],
    maxIterations: 8,
  },
];
