import fs from "fs";
import path from "path";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import type { AutonomousDocument } from "./types";
import type { PlanRepairRecord } from "./plan-repair";

/** Shared contract file — exports and field shapes must not regress. */
export const PROTECTED_CONTRACT_PATHS = ["src/contracts.ts"] as const;

/** Stable implementers that must not be gutted or have public API changed. */
export const PROTECTED_IMPLEMENTER_PATHS = [
  "src/context-assembler.ts",
  "src/memory-record-store.ts",
  "src/event-log.ts",
  "src/write-pipeline.ts",
  "src/retrieval-engine.ts",
  "src/explain.ts",
  "src/consolidation.ts",
  "src/context-budget-assembler.ts",
  "src/memory-class.ts",
] as const;

export const PROTECTED_SCAFFOLD_PATHS = [
  ...PROTECTED_CONTRACT_PATHS,
  ...PROTECTED_IMPLEMENTER_PATHS,
] as const;

export type ProtectedScaffoldPath = (typeof PROTECTED_SCAFFOLD_PATHS)[number];

export function normalizeScaffoldRelativePath(relativePath: string): string {
  return relativePath.replace(/^\.?\//, "");
}

export function isProtectedScaffoldPath(relativePath: string): relativePath is ProtectedScaffoldPath {
  return PROTECTED_SCAFFOLD_PATHS.includes(
    normalizeScaffoldRelativePath(relativePath) as ProtectedScaffoldPath,
  );
}

export function isProtectedContractPath(relativePath: string): boolean {
  return PROTECTED_CONTRACT_PATHS.includes(
    normalizeScaffoldRelativePath(relativePath) as (typeof PROTECTED_CONTRACT_PATHS)[number],
  );
}

export function objectiveTouchesContracts(input: {
  objective?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
}): boolean {
  const haystack = [
    input.objective ?? "",
    ...(input.requirements ?? []),
    ...(input.acceptanceCriteria ?? []),
  ]
    .join("\n")
    .toLowerCase();
  return (
    haystack.includes("contracts.ts")
    || haystack.includes("src/contracts")
    || /\bcontracts\b/.test(haystack)
    || haystack.includes("memoryproposal")
    || haystack.includes("memoryclass")
    || haystack.includes("assembledcontext")
  );
}

export function extractTypeScriptExports(source: string): Set<string> {
  const names = new Set<string>();
  const direct =
    /export\s+(?:declare\s+)?(?:type|interface|class|function|enum|abstract class)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = direct.exec(source)) !== null) {
    names.add(match[1]);
  }
  const reexport = /export\s*\{([^}]+)\}/g;
  while ((match = reexport.exec(source)) !== null) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/);
      if (asMatch) names.add(asMatch[2] ?? asMatch[1]);
    }
  }
  return names;
}

export function detectMissingContractExports(
  baselineContent: string,
  nextContent: string,
): string[] {
  const baseline = extractTypeScriptExports(baselineContent);
  const next = extractTypeScriptExports(nextContent);
  const missing: string[] = [];
  for (const name of baseline) {
    if (!next.has(name)) missing.push(name);
  }
  return missing.sort();
}

/** Block scaffold contract shape regressions (export names may survive while fields are gutted). */
export function detectContractShapeRegressions(
  baselineContent: string,
  nextContent: string,
): string[] {
  const defects: string[] = [];
  if (!baselineContent.includes("MemoryRecord")) return defects;

  if (baselineContent.includes("kind: MemoryRecordKind") && !nextContent.includes("kind: MemoryRecordKind")) {
    defects.push(
      "MemoryRecord.kind removed or renamed; add memoryClass alongside kind — do not replace kind with memoryRecordKind.",
    );
  }
  if (baselineContent.includes("supersededById") && !nextContent.includes("supersededById")) {
    defects.push("MemoryRecord.supersededById removed; supersede must link prior record to replacement id.");
  }
  if (
    baselineContent.includes("export interface MemoryRecordStore")
    && !nextContent.includes("export interface MemoryRecordStore")
  ) {
    defects.push("MemoryRecordStore interface removed or renamed.");
  }
  if (baselineContent.includes("content: string") && /\bcontent:\s*any\b/.test(nextContent)) {
    defects.push("MemoryEvent.content must stay string — do not widen to any.");
  }
  return defects;
}

/** Block implementer modules from losing required public API surface. */
export function detectImplementerShapeRegressions(
  relativePath: string,
  baselineContent: string,
  nextContent: string,
): string[] {
  const normalized = normalizeScaffoldRelativePath(relativePath);
  const defects: string[] = [];

  if (normalized === "src/context-assembler.ts") {
    const required = ["assemble(", "text,", "recordIds", "eventIds", "estimatedTokens"];
    for (const marker of required) {
      if (baselineContent.includes(marker) && !nextContent.includes(marker)) {
        defects.push(
          `context-assembler lost required AssembledContext field/method marker \`${marker}\`; extend assemble() additively — do not change return shape.`,
        );
      }
    }
    if (baselineContent.includes("implements") && !nextContent.includes("assemble(")) {
      defects.push("context-assembler.assemble() removed or renamed.");
    }
  }

  if (normalized === "src/memory-record-store.ts") {
    for (const method of ["upsert(", "get(", "list(", "supersede("]) {
      if (baselineContent.includes(method) && !nextContent.includes(method)) {
        defects.push(
          `memory-record-store lost required store method \`${method}\`; preserve InMemoryMemoryRecordStore API.`,
        );
      }
    }
  }

  if (normalized === "src/event-log.ts") {
    for (const method of ["append(", "list(", "get("]) {
      if (baselineContent.includes(method) && !nextContent.includes(method)) {
        defects.push(`event-log lost required EventLog method \`${method}\`.`);
      }
    }
  }

  if (normalized === "src/write-pipeline.ts") {
    for (const fn of ["shouldIgnoreEvent(", "buildMemoryProposal(", "commitProposal("]) {
      if (baselineContent.includes(fn) && !nextContent.includes(fn)) {
        defects.push(`write-pipeline lost required function \`${fn}\` — preserve existing implementation.`);
      }
    }
  }

  if (normalized === "src/retrieval-engine.ts") {
    if (baselineContent.includes("hybridRetrieve(") && !nextContent.includes("hybridRetrieve(")) {
      defects.push("retrieval-engine lost required function `hybridRetrieve(` — preserve existing implementation.");
    }
  }

  if (normalized === "src/explain.ts") {
    if (baselineContent.includes("explainMemory(") && !nextContent.includes("explainMemory(")) {
      defects.push("explain lost required function `explainMemory(` — preserve existing implementation.");
    }
  }

  if (normalized === "src/consolidation.ts") {
    if (baselineContent.includes("consolidateMemories(") && !nextContent.includes("consolidateMemories(")) {
      defects.push("consolidation lost required function `consolidateMemories(` — preserve existing implementation.");
    }
  }

  if (normalized === "src/context-budget-assembler.ts") {
    if (baselineContent.includes("assemble(") && !nextContent.includes("assemble(")) {
      defects.push("context-budget-assembler lost required class method `assemble(` — preserve existing implementation.");
    }
  }

  if (normalized === "src/memory-class.ts") {
    if (baselineContent.includes("classifyMemory(") && !nextContent.includes("classifyMemory(")) {
      defects.push("memory-class lost required function `classifyMemory(` — preserve existing implementation.");
    }
  }

  return defects;
}

export function readScaffoldBaselineFile(
  hostRepoPath: string,
  relativePath: string,
): string | null {
  const abs = path.join(hostRepoPath, relativePath);
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export function validateProtectedScaffoldContent(input: {
  baselineRepoPath: string;
  relativePath: string;
  nextContent: string;
}): string[] {
  const normalized = normalizeScaffoldRelativePath(input.relativePath);
  if (!isProtectedScaffoldPath(normalized)) return [];

  const baseline = readScaffoldBaselineFile(input.baselineRepoPath, normalized);
  if (!baseline) return [];

  const defects: string[] = [];

  if (isProtectedContractPath(normalized)) {
    const missing = detectMissingContractExports(baseline, input.nextContent).map(
      (name) =>
        `Protected export \`${name}\` removed from ${normalized}; extend contracts without deleting existing exports.`,
    );
    const shape = detectContractShapeRegressions(baseline, input.nextContent).map(
      (message) => `${normalized}: ${message}`,
    );
    defects.push(...missing, ...shape);
  }

  defects.push(...detectImplementerShapeRegressions(normalized, baseline, input.nextContent));

  return defects;
}

/** @deprecated Use validateProtectedScaffoldContent */
export function validateProtectedContractContent(input: {
  hostRepoPath: string;
  relativePath: string;
  nextContent: string;
}): string[] {
  return validateProtectedScaffoldContent({
    baselineRepoPath: input.hostRepoPath,
    relativePath: input.relativePath,
    nextContent: input.nextContent,
  });
}

export function contractRegressionDefects(input: {
  hostRepoPath: string;
  worktreeContents: Record<string, string>;
}): string[] {
  const defects: string[] = [];
  for (const relative of PROTECTED_SCAFFOLD_PATHS) {
    const current = input.worktreeContents[relative];
    if (!current) continue;
    for (const message of validateProtectedScaffoldContent({
      baselineRepoPath: input.hostRepoPath,
      relativePath: relative,
      nextContent: current,
    })) {
      defects.push(`${relative}: ${message}`);
    }
  }
  return defects;
}

export function countScaffoldContractRepairs(history: PlanRepairRecord[] | undefined): number {
  return (history ?? []).filter((record) => record.kind === "scaffold_contract").length;
}

export function shouldFreezeContractsAfterRepairs(history: PlanRepairRecord[] | undefined): boolean {
  return countScaffoldContractRepairs(history) >= 2;
}

export function isContractsFrozen(document: AutonomousDocument): boolean {
  return document.scaffoldGuard?.contractsFrozen === true;
}

export function validatePlanScaffoldOperations(
  repoPath: string,
  plan: WorkerPlan,
  document: AutonomousDocument,
): string[] {
  const errors: string[] = [];
  const contractsFrozen = isContractsFrozen(document);

  for (const [index, operation] of (plan.operations ?? []).entries()) {
    const relative = normalizeScaffoldRelativePath(operation.path);
    if (!isProtectedScaffoldPath(relative)) continue;

    if (contractsFrozen && isProtectedContractPath(relative)) {
      errors.push(
        `operation ${index}: src/contracts.ts is frozen after repeated contract regressions — implement in new modules only; do not mutate contracts.ts`,
      );
      continue;
    }

    if (operation.type === "delete_file") {
      errors.push(`operation ${index}: cannot delete protected scaffold file ${relative}`);
      continue;
    }

    if (operation.type !== "create_file" && operation.type !== "update_file" && operation.type !== "append_file") {
      continue;
    }

    const baseline = readScaffoldBaselineFile(repoPath, relative);
    if (!baseline) continue;

    let nextContent = operation.content;
    if (operation.type === "append_file") {
      nextContent = `${baseline}${operation.content}`;
    }

    for (const message of validateProtectedScaffoldContent({
      baselineRepoPath: repoPath,
      relativePath: relative,
      nextContent,
    })) {
      errors.push(`operation ${index} on ${relative}: ${message}`);
    }

    if (operation.type === "update_file" && isProtectedContractPath(relative)) {
      if (nextContent.length < baseline.length * 0.85) {
        errors.push(
          `operation ${index}: contracts.ts update shrinks file (${baseline.length} → ${nextContent.length} bytes) — use complete baseline plus additive edits only`,
        );
      }
    }
  }

  return errors;
}

export function formatContractsContextBlock(repoPath: string, objectiveTouches: boolean): string {
  const contractsPath = path.join(repoPath, "src/contracts.ts");
  if (!fs.existsSync(contractsPath)) return "";
  try {
    const contracts = fs.readFileSync(contractsPath, "utf8");
    return [
      "FULL src/contracts.ts (baseline — preserve every export and field; import types from ./contracts.js):",
      contracts.slice(0, 12_000),
    ].join("\n");
  } catch {
    return "";
  }
}

export const SNIPPET_PRIORITY_PATHS = [
  "src/contracts.ts",
  "src/memory-record-store.ts",
  "src/context-assembler.ts",
  "src/event-log.ts",
] as const;
