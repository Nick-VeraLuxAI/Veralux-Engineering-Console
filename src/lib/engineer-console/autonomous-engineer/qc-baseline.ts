import type { QualityGateCommandResult } from "../quality-gates/quality-gate-runner";

export const QC_CLASSIFICATIONS = [
  "PASS",
  "NEW_FAILURE",
  "PRE_EXISTING_FAILURE",
  "CHANGED_FAILURE",
  "RESOLVED_BASELINE_FAILURE",
  "INFRASTRUCTURE_FAILURE",
  "SKIPPED",
] as const;

export type QcClassification = (typeof QC_CLASSIFICATIONS)[number];

export type QcFailureKind = "test" | "typescript" | "lint" | "build" | "command";

export interface QcFailureIdentity {
  key: string;
  kind: QcFailureKind;
  command: string;
  name: string;
  location?: string;
  fingerprint: string;
  rawEvidence: string;
}

export interface QcGateSnapshot {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface QcBaselineSnapshot {
  capturedAt: string;
  repoPath: string;
  gates: QcGateSnapshot[];
  failures: QcFailureIdentity[];
}

export interface QcClassifiedFinding {
  identity: QcFailureIdentity;
  classification: QcClassification;
  baselineFingerprint: string | null;
  currentFingerprint: string | null;
}

export interface QcDelta {
  capturedAt: string;
  findings: QcClassifiedFinding[];
  newFailures: QcClassifiedFinding[];
  preExistingFailures: QcClassifiedFinding[];
  changedFailures: QcClassifiedFinding[];
  resolvedBaselineFailures: QcClassifiedFinding[];
  infrastructureFailures: QcClassifiedFinding[];
  skipped: QcClassifiedFinding[];
  objectiveQcPassed: boolean;
  ownedIterationFailures: QcClassifiedFinding[];
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 800);
}

function fingerprint(text: string): string {
  const normalized = normalizeWs(text);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `${normalized.slice(0, 160)}#${hash}`;
}

function isInfrastructureOutput(stdout: string, stderr: string, exitCode: number): boolean {
  const blob = `${stdout}\n${stderr}`.toLowerCase();
  const runnerMissing = blob.includes("spawn ") && blob.includes("enoent");
  const hostUnresolved = blob.includes("enotfound") && !blob.includes("fail ");
  return (
    blob.includes("etimedout") ||
    hostUnresolved ||
    runnerMissing ||
    exitCode === 127
  );
}

function extractTypescriptFailures(command: string, output: string): QcFailureIdentity[] {
  const identities: QcFailureIdentity[] = [];
  const regex = /([^\s(]+\.tsx?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const file = match[1];
    const location = `${file}:${match[2]}:${match[3]}`;
    const name = `${file} ${match[4]}`;
    const message = match[5] ?? "";
    identities.push({
      key: `typescript:${file}:${match[4]}:${match[2]}:${match[3]}`,
      kind: "typescript",
      command,
      name,
      location,
      fingerprint: fingerprint(`${location} ${match[4]} ${message}`),
      rawEvidence: match[0],
    });
  }
  return identities;
}

function extractLintFailures(command: string, output: string): QcFailureIdentity[] {
  const identities: QcFailureIdentity[] = [];
  const stylish = /([^\s:]+):(\d+):(\d+):\s+(?:error|warning)\s+(.+?)\s+(\S+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = stylish.exec(output)) !== null) {
    const file = match[1];
    const rule = match[5];
    const location = `${file}:${match[2]}:${match[3]}`;
    identities.push({
      key: `lint:${file}:${rule}`,
      kind: "lint",
      command,
      name: `${rule} ${file}`,
      location,
      fingerprint: fingerprint(`${location} ${rule} ${match[4]}`),
      rawEvidence: match[0],
    });
  }
  return identities;
}

function stripVitestTiming(text: string): string {
  return text.replace(/\s+\d+(?:\.\d+)?m?s\s*$/i, "").trim();
}

function leafTestName(text: string): string {
  const stripped = stripVitestTiming(text);
  const separator = stripped.includes(" > ") ? " > " : stripped.includes(" › ") ? " › " : null;
  if (!separator) return stripped;
  return stripped.slice(stripped.lastIndexOf(separator) + separator.length).trim();
}

function extractTestFailures(command: string, output: string): QcFailureIdentity[] {
  const identities: QcFailureIdentity[] = [];
  const seen = new Set<string>();

  // Extract vitest failure blocks with error message / stack frames
  const failBlockRegex =
    /(?:FAIL|×|x)\s+(\S+\.(?:test|spec)\.[jt]sx?)\s+>\s+([^\n]+)([\s\S]*?)(?=(?:FAIL|×|x)\s+\S+\.(?:test|spec)\.[jt]sx?|⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯|Test Files|$)/g;
  let match: RegExpExecArray | null;
  while ((match = failBlockRegex.exec(output)) !== null) {
    const file = match[1].trim();
    const rest = stripVitestTiming(match[2]);
    const leaf = leafTestName(rest);
    const key = `test:${file}:${leaf}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawBody = (match[3] || "").trim();
    const cleanedBody = rawBody
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !l.startsWith("⎯⎯⎯") && !l.startsWith("RUN  v") && !l.startsWith("Test Files"))
      .join("\n")
      .trim();

    const fullEvidence = cleanedBody
      ? `FAIL  ${file} > ${rest}\n${cleanedBody}`
      : `FAIL  ${file} > ${rest}`;

    identities.push({
      key,
      kind: "test",
      command,
      name: rest,
      location: file,
      fingerprint: fingerprint(`${file} ${leaf}`),
      rawEvidence: fullEvidence.slice(0, 1200),
    });
  }

  // Fallback simple line match if multiline block extraction didn't catch anything
  if (identities.length === 0) {
    const failFile = /FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)\s+>\s+(.+)/g;
    while ((match = failFile.exec(output)) !== null) {
      const file = match[1].trim();
      const rest = stripVitestTiming(match[2]);
      const leaf = leafTestName(rest);
      const key = `test:${file}:${leaf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      identities.push({
        key,
        kind: "test",
        command,
        name: rest,
        location: file,
        fingerprint: fingerprint(`${file} ${leaf}`),
        rawEvidence: match[0],
      });
    }
  }

  if (identities.length === 0) {
    const vitest = /(?:FAIL|×|x)\s+(.+?)(?:\s+>\s+|\s+›\s+)(.+)/g;
    while ((match = vitest.exec(output)) !== null) {
      const file = stripVitestTiming(match[1].trim());
      const testName = stripVitestTiming(match[2].trim());
      const leaf = leafTestName(`${file} > ${testName}`);
      const key = `test:${file}:${leaf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      identities.push({
        key,
        kind: "test",
        command,
        name: testName,
        location: file,
        fingerprint: fingerprint(`${file} ${leaf}`),
        rawEvidence: match[0],
      });
    }
  }

  // node:test TAP: preserve ReferenceError + stack so diagnosis can attribute production frames.
  if (identities.length === 0 && /not ok\s+\d+/i.test(output)) {
    const tapBlocks = output.split(/(?=# Subtest:|not ok\s+\d+)/i);
    for (const block of tapBlocks) {
      if (!/not ok\s+\d+/i.test(block) && !/failureType:\s*['"]?testCodeFailure/i.test(block)) {
        continue;
      }
      const nameMatch =
        block.match(/not ok\s+\d+\s+-\s+(.+)/i) || block.match(/# Subtest:\s*(.+)/i);
      const leaf = (nameMatch?.[1] ?? "tap-failure").trim().slice(0, 120);
      const locMatch = block.match(/location:\s*['"]?([^\s'"]+\.(?:js|ts|mjs|cjs))/i);
      const file = locMatch?.[1]?.replace(/^.*\/(src\/)/, "src/") ?? command;
      const errMatch =
        block.match(/name:\s*['"]?(ReferenceError|TypeError)['"]?[\s\S]{0,80}?error:\s*['"]([^'"]+)['"]/i) ||
        block.match(/error:\s*['"]([^'"]*is not defined[^'"]*)['"]/i) ||
        block.match(/ReferenceError:\s*([^\n]+)/i);
      const errText = Array.isArray(errMatch) ? errMatch[errMatch.length - 1] : "tap failure";
      const key = `test:${file}:${leaf}:${fingerprint(errText).slice(0, 12)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Keep stack frames in rawEvidence for UNBOUND_IDENTIFIER attribution.
      const stackIdx = block.search(/stack:\s*\|-/i);
      const evidence =
        stackIdx >= 0
          ? block.slice(Math.max(0, block.search(/error:|ReferenceError|name:/i)), stackIdx + 400)
          : block.slice(0, 900);
      identities.push({
        key,
        kind: "test",
        command,
        name: `${leaf}: ${errText}`.slice(0, 160),
        location: file,
        fingerprint: fingerprint(`${file} ${leaf} ${errText}`),
        rawEvidence: normalizeWs(evidence).slice(0, 1200),
      });
    }
  }

  if (identities.length === 0) {
    const assertion = /AssertionError[:\s]+(.+)/g;
    while ((match = assertion.exec(output)) !== null) {
      identities.push({
        key: `test:${command}:${normalizeWs(match[1]).slice(0, 80)}`,
        kind: "test",
        command,
        name: normalizeWs(match[1]).slice(0, 120),
        fingerprint: fingerprint(match[1]),
        rawEvidence: match[0],
      });
    }
  }
  return identities;
}

function commandKind(command: string): QcFailureKind {
  const lower = command.toLowerCase();
  if (lower.includes("typecheck") || lower.includes("tsc")) return "typescript";
  if (lower.includes("lint") || lower.includes("eslint")) return "lint";
  if (lower.includes("build")) return "build";
  if (lower.includes("test")) return "test";
  return "command";
}

export function extractFailureIdentities(gate: QcGateSnapshot): QcFailureIdentity[] {
  if (gate.status === "skipped") {
    return [
      {
        key: `skipped:${gate.command}`,
        kind: commandKind(gate.command),
        command: gate.command,
        name: gate.command,
        fingerprint: "skipped",
        rawEvidence: gate.stderr || "skipped",
      },
    ];
  }
  if (gate.status === "passed") return [];

  const output = `${gate.stdout}\n${gate.stderr}`;
  if (isInfrastructureOutput(gate.stdout, gate.stderr, gate.exitCode)) {
    return [
      {
        key: `infra:${gate.command}`,
        kind: "command",
        command: gate.command,
        name: gate.command,
        fingerprint: fingerprint(output),
        rawEvidence: normalizeWs(output).slice(0, 1200),
      },
    ];
  }

  const extracted = [
    ...extractTypescriptFailures(gate.command, output),
    ...extractLintFailures(gate.command, output),
    ...extractTestFailures(gate.command, output),
  ];
  if (extracted.length > 0) return extracted;

  return [
    {
      key: `${commandKind(gate.command)}:${gate.command}`,
      kind: commandKind(gate.command),
      command: gate.command,
      name: gate.command,
      fingerprint: fingerprint(`${gate.command}:${gate.status}:${gate.exitCode}`),
      rawEvidence: normalizeWs(output).slice(0, 1200),
    },
  ];
}

export function snapshotQcResults(
  results: Array<Pick<QualityGateCommandResult, "command" | "status" | "exitCode" | "stdout" | "stderr" | "durationMs">>,
  repoPath: string,
  now = () => new Date(),
): QcBaselineSnapshot {
  const gates: QcGateSnapshot[] = results.map((result) => ({
    command: result.command,
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  }));
  const failures = gates.flatMap((gate) =>
    gate.status === "failed" ? extractFailureIdentities(gate) : [],
  );
  return {
    capturedAt: now().toISOString(),
    repoPath,
    gates,
    failures,
  };
}

function classificationForPair(
  baseline: QcFailureIdentity | undefined,
  current: QcFailureIdentity | undefined,
  gateStillFailed = false,
): QcClassification {
  if (current && current.key.startsWith("infra:")) return "INFRASTRUCTURE_FAILURE";
  if (current && current.key.startsWith("skipped:")) return "SKIPPED";
  if (baseline && !current) {
    if (gateStillFailed) return "PRE_EXISTING_FAILURE";
    return "RESOLVED_BASELINE_FAILURE";
  }
  if (!baseline && current) return "NEW_FAILURE";
  if (baseline && current) {
    if (baseline.fingerprint === current.fingerprint) return "PRE_EXISTING_FAILURE";
    return "CHANGED_FAILURE";
  }
  return "PASS";
}

export function compareQcToBaseline(
  baseline: QcBaselineSnapshot | null,
  currentResults: Array<Pick<QualityGateCommandResult, "command" | "status" | "exitCode" | "stdout" | "stderr" | "durationMs">>,
  now = () => new Date(),
  options: { mutatedThisIteration?: boolean } = {},
): QcDelta {
  const currentSnapshot = snapshotQcResults(currentResults, baseline?.repoPath ?? "", now);
  const baselineByKey = new Map((baseline?.failures ?? []).map((item) => [item.key, item]));
  const currentByKey = new Map(currentSnapshot.failures.map((item) => [item.key, item]));
  const skippedCurrent = currentSnapshot.gates
    .filter((gate) => gate.status === "skipped")
    .map((gate) => extractFailureIdentities({ ...gate, status: "skipped" })[0])
    .filter(Boolean);

  const failedCommands = new Set(
    currentSnapshot.gates.filter((gate) => gate.status === "failed").map((gate) => gate.command),
  );

  const keys = new Set([...baselineByKey.keys(), ...currentByKey.keys()]);
  const findings: QcClassifiedFinding[] = [];

  for (const key of keys) {
    const before = baselineByKey.get(key);
    const after = currentByKey.get(key);
    const identity = after ?? before;
    if (!identity) continue;
    const gateStillFailed = failedCommands.has(identity.command);
    const classification = classificationForPair(before, after, gateStillFailed);
    const genericTestKey = after?.kind === "test" && after.key === `test:${after.command}`;
    const adjusted =
      genericTestKey && options.mutatedThisIteration && after
        ? before
          ? "CHANGED_FAILURE"
          : "NEW_FAILURE"
        : classification;
    if (adjusted === "PASS") continue;
    findings.push({
      identity,
      classification: adjusted,
      baselineFingerprint: before?.fingerprint ?? null,
      currentFingerprint: after?.fingerprint ?? null,
    });
  }

  for (const skipped of skippedCurrent) {
    if (findings.some((finding) => finding.identity.key === skipped.key)) continue;
    findings.push({
      identity: skipped,
      classification: "SKIPPED",
      baselineFingerprint: null,
      currentFingerprint: skipped.fingerprint,
    });
  }

  const newFailures = findings.filter((item) => item.classification === "NEW_FAILURE");
  const preExistingFailures = findings.filter((item) => item.classification === "PRE_EXISTING_FAILURE");
  const changedFailures = findings.filter((item) => item.classification === "CHANGED_FAILURE");
  const resolvedBaselineFailures = findings.filter(
    (item) => item.classification === "RESOLVED_BASELINE_FAILURE",
  );
  const infrastructureFailures = findings.filter(
    (item) => item.classification === "INFRASTRUCTURE_FAILURE",
  );
  const skipped = findings.filter((item) => item.classification === "SKIPPED");
  const ownedIterationFailures = [...newFailures, ...changedFailures, ...infrastructureFailures];

  return {
    capturedAt: now().toISOString(),
    findings,
    newFailures,
    preExistingFailures,
    changedFailures,
    resolvedBaselineFailures,
    infrastructureFailures,
    skipped,
    objectiveQcPassed: ownedIterationFailures.length === 0,
    ownedIterationFailures,
  };
}

export function qcIterationShouldFail(delta: QcDelta): boolean {
  return delta.ownedIterationFailures.length > 0;
}

/** Structured QC failure block for planning/replan prompts. */
export function formatQcDeltaRepairBlock(delta: QcDelta | null | undefined): string {
  if (!delta || delta.objectiveQcPassed) return "";
  const actionable = [...delta.newFailures, ...delta.changedFailures, ...delta.infrastructureFailures];
  if (actionable.length === 0) return "";

  const lines = ["Active QC failures to fix before delivery (address every line):"];
  for (const finding of actionable.slice(0, 16)) {
    const id = finding.identity;
    const where = id.location ?? id.name;
    lines.push(`- [${id.kind}] ${where}: ${id.rawEvidence}`);
  }
  if (actionable.some((finding) => finding.identity.kind === "typescript")) {
    lines.push(
      "TypeScript repair rules: fix call sites and signatures together; use Partial<> or optional fields for patch/supersede inputs; never import Omit from application modules (Omit is a TS utility); do not read fields omitted from a parameter type.",
    );
    lines.push(
      "Vitest fixture rules: nest tenantId/projectId/runId/taskId inside scope (not at the record root); avoid `as const` on whole fixture objects — instead type kind as MemoryRecordKind ('durable' | 'transient' | 'summary'); use plain string[] for provenanceEventIds; name the class InMemoryMemoryRecordStore and import MemoryRecordStore as a type alias; use expect(x).toHaveLength(n) — Vitest has no toContainLength.",
    );
    lines.push(
      "MemoryRecordStore semantics: upsert({ ...fields, id }) MUST update the existing record and keep the same id; upsert without id creates a new record. When a test expects the same id after update, the second upsert MUST include id: first.id. supersede(id, partial) inherits missing fields from the prior record.",
    );
    if (
      actionable.some((finding) =>
        /Property 'memoryClass' is missing|Property 'kind' is missing/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Schema evolution: when adding memoryClass to contracts, keep kind and make memoryClass optional on MemoryRecordWriteInput OR infer memoryClass from kind inside the store so existing tests unchanged.",
      );
    }
    if (actionable.some((finding) => /Failed to load url \.\./i.test(finding.identity.rawEvidence))) {
      lines.push(
        "Vitest imports must use .js extension and same-directory paths (e.g. ./memory-record-store.js) — never bare ../module without .js.",
      );
    }
    if (
      actionable.some((finding) =>
        /TS2352|Conversion of type|missing the following properties/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Cast repair: do not cast incomplete objects to MemoryRecordWriteInput. Build a full object with statement, kind (MemoryRecordKind), confidence (number), scope, and optional provenanceEventIds — or use `as unknown as MemoryRecordWriteInput` only as last resort.",
      );
    }
    if (
      actionable.some((finding) =>
        /TS1005|TS1128|TS1109|'\)' expected/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Syntax repair: helper files need valid TypeScript — one parameter type block only; import types from ./contracts.js (e.g. MemoryScope, MemoryRecordKind, MemoryRecordWriteInput); never duplicate `}: {` parameter annotations.",
      );
    }
    if (
      actionable.some((finding) =>
        /Cannot read properties of undefined \(reading '0'\)|buildMemoryProposal/i.test(
          finding.identity.rawEvidence,
        ),
      )
    ) {
      lines.push(
        "buildMemoryProposal repair: pass `candidates ?? []` (or `candidates ?? [\"semantic\"]`) to buildMemoryProposal so candidates is never undefined.",
      );
    }
    if (
      actionable.some((finding) =>
        /Cannot find name '(MemoryEvent|MemoryRecord|AssembledContext|RetrievalQuery|MemoryClass|commitProposal|buildMemoryProposal|shouldIgnoreEvent|explainMemory|hybridRetrieve|BudgetedContextAssembler|InMemoryContextAssembler|ExplainResult)'|ReferenceError: (commitProposal|buildMemoryProposal|shouldIgnoreEvent|explainMemory|hybridRetrieve|InMemoryContextAssembler|ExplainResult)/i.test(
          finding.identity.rawEvidence,
        ),
      )
    ) {
      lines.push(
        "Import repair: In src/memory-service.ts ensure all functions and types are imported:\n" +
        "- import type { EventLog, MemoryRecordStore, MemoryEvent, MemoryRecord, MemoryClass, RetrievalQuery, AssembledContext, MemoryProposal, RetrievalFeedback, FeedbackLog } from \"./contracts.js\";\n" +
        "- import { shouldIgnoreEvent, buildMemoryProposal, commitProposal } from \"./write-pipeline.js\";\n" +
        "- import { hybridRetrieve } from \"./retrieval-engine.js\";\n" +
        "- import { BudgetedContextAssembler } from \"./context-budget-assembler.js\";\n" +
        "- import { explainMemory, type ExplainResult } from \"./explain.js\";\n" +
        "Note: Use `new BudgetedContextAssembler()` for context assembly, NOT `InMemoryContextAssembler`.",
      );
    }
    if (
      actionable.some((finding) =>
        /Cannot read properties of undefined \(reading 'feedbackLog'\)|TS2322.*feedbackLog/i.test(
          finding.identity.rawEvidence,
        ),
      )
    ) {
      lines.push(
        "Options repair: in MemoryService, declare `private readonly options?: { feedbackLog?: FeedbackLog };` (make options optional with `?`) and access with optional chaining `this.options?.feedbackLog`.",
      );
    }
    if (
      actionable.some((finding) =>
        /TS2613.*has no default export|default is not a constructor/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Import style repair (TS2613): Use named imports `import { InMemoryFeedbackLog } from \"./feedback-log.js\";` (not default import `import InMemoryFeedbackLog from ...`).",
      );
    }
    if (
      actionable.some((finding) =>
        /TS2459|TS2305.*(?:declares '.*' locally, but it is not exported|has no exported member)/i.test(
          finding.identity.rawEvidence,
        ),
      )
    ) {
      lines.push(
        "Re-export repair (TS2459/TS2305): Export types (EventLog, MemoryRecordStore, MemoryRecord, MemoryEvent, MemoryProposal, RetrievalFeedback, FeedbackLog, MemoryClass, RetrievalQuery, AssembledContext) from \"./contracts.js\". Export implementations from their respective files (InMemoryEventLog from \"./event-log.js\", InMemoryMemoryRecordStore from \"./memory-record-store.js\", InMemoryFeedbackLog from \"./feedback-log.js\", MemoryService from \"./memory-service.js\").",
      );
    }
    if (
      actionable.some((finding) =>
        /TS1232|An import declaration can only be used at the top level/i.test(
          finding.identity.rawEvidence,
        ),
      )
    ) {
      lines.push(
        "Top-level import repair (TS1232): Place ALL `import` declarations at the very top of the file, outside of `describe(...)` or `it(...)` blocks.",
      );
    }
    if (
      actionable.some((finding) =>
        /TS2741: Property 'id' is missing/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Event fixture repair: MemoryEvent requires { id: \"evt-1\", occurredAt: new Date().toISOString(), scope: { projectId: \"p1\" }, type: \"user_action\", content: \"hello\", metadata: {} }.",
      );
    }
    if (
      actionable.some((finding) =>
        /TS18047.*(?:'record' is possibly 'null'|possibly 'null')/i.test(finding.identity.rawEvidence),
      )
    ) {
      lines.push(
        "Null check repair (TS18047): in src/memory-service.test.ts, proposeAndCommit returns MemoryRecord | null. Immediately after const record = svc.proposeAndCommit(...); add `expect(record).not.toBeNull();` and `if (!record) throw new Error(\"record was null\");` so TypeScript narrows record to MemoryRecord for the rest of the test.",
      );
    }
  }
  return lines.join("\n");
}
