import fs from "fs";
import path from "path";
import type { AutonomousDocument } from "./types";
import type { QcDelta } from "./qc-baseline";
import { listAuthorizedWorktreeFiles } from "./plan-worktree-adapter";

/**
 * Hard delivery readiness — closes the autonomy gap where AE declared
 * "delivery ready" with skipped QC and thin Map get/set stubs.
 */

export function qcEvidenceSupportsDelivery(delta: QcDelta | null | undefined): boolean {
  if (!delta) return false;
  if (!delta.objectiveQcPassed) return false;
  // All-skipped QC is not evidence the objective works.
  if (
    delta.skipped.length > 0 &&
    delta.findings.length > 0 &&
    delta.findings.every((finding) => finding.classification === "SKIPPED")
  ) {
    return false;
  }
  return true;
}

function objectiveBlob(document: AutonomousDocument): string {
  const interpretation = document.interpretedObjective;
  return [
    document.originalObjective,
    ...(document.acceptanceCriteria ?? []),
    ...(document.requirements ?? []),
    interpretation?.objectiveSummary ?? "",
    ...(interpretation?.acceptanceCriteria ?? []),
    ...(interpretation?.requirements ?? []),
  ]
    .join("\n")
    .toLowerCase();
}

function readPackageJson(repoPath: string): { hasTestScript: boolean; raw: string } | null {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts ?? {};
    const hasTestScript = Boolean(scripts.test || scripts["test:unit"] || scripts.vitest);
    return { hasTestScript, raw };
  } catch {
    return { hasTestScript: false, raw: "" };
  }
}

function isThinKeyValueStub(contents: Record<string, string>): boolean {
  const prod = Object.entries(contents)
    .filter(([file]) => !/\.(test|spec)\./.test(file) && !file.includes("__tests__/"))
    .map(([, body]) => body)
    .join("\n");
  // No JS/TS sources is not a Map stub (e.g. ready.txt-only specimen missions).
  if (!prod.trim()) return false;
  const hasMapStore = /new\s+Map\s*\(/.test(prod);
  const hasGetSet =
    /\bexport\s+function\s+get\b/.test(prod) && /\bexport\s+function\s+set\b/.test(prod);
  const hasDomainTypes =
    /\b(EventLog|MemoryEvent|MemoryRecord|append\s*\(|InMemoryEventLog|provenance|RetrievalQuery|ContextAssembler)\b/.test(
      prod,
    );
  const lineCount = prod.split("\n").filter((line) => line.trim()).length;
  return hasMapStore && hasGetSet && !hasDomainTypes && lineCount < 80;
}

/**
 * Structural unmet criteria for greenfield / foundation missions.
 * Returns human-readable blockers (empty = structural OK).
 */
export function evaluateStructuralDeliveryGates(input: {
  document: AutonomousDocument;
  repoPath?: string;
  qcDelta?: QcDelta | null;
  changedFiles: string[];
}): string[] {
  const blockers: string[] = [];
  const blob = objectiveBlob(input.document);
  const wantsBuild =
    /\b(implement|build|create|foundation|module|package|typescript|vitest|test|event\s*log|memory|contract)\b/i.test(
      blob,
    );

  if (!wantsBuild) {
    if (input.qcDelta != null && !qcEvidenceSupportsDelivery(input.qcDelta)) {
      blockers.push(
        "Executable quality gates did not run successfully (QC missing, failed, or only skipped). Add a test script and make npm test pass before delivery.",
      );
    }
    return blockers;
  }

  if (input.qcDelta != null && !qcEvidenceSupportsDelivery(input.qcDelta)) {
    blockers.push(
      "Executable quality gates did not run successfully (QC missing, failed, or only skipped). Add a test script and make npm test pass before delivery.",
    );
  }

  if (!input.repoPath || !fs.existsSync(input.repoPath)) {
    blockers.push("No worktree available to verify structural delivery gates.");
    return blockers;
  }

  const prefixes = input.document.authorizedPathPrefixes?.length
    ? input.document.authorizedPathPrefixes
    : ["src/"];
  const tree = listAuthorizedWorktreeFiles(input.repoPath, prefixes, 120);
  const contents: Record<string, string> = {};
  for (const relative of tree) {
    if (!/\.(js|ts|mjs|cjs)$/.test(relative)) continue;
    try {
      contents[relative] = fs.readFileSync(path.join(input.repoPath, relative), "utf8");
    } catch {
      // skip
    }
  }

  const pkg = readPackageJson(input.repoPath);
  const hasTestFiles = tree.some(
    (file) => /\.(test|spec)\.(js|ts|mjs|cjs)$/.test(file) || file.includes("__tests__/"),
  );

  if (!pkg?.hasTestScript && !hasTestFiles) {
    blockers.push(
      "No package.json test script and no test files in the authorized tree. Delivery requires runnable tests.",
    );
  } else if (pkg && !pkg.hasTestScript && hasTestFiles) {
    blockers.push(
      "Test files exist but package.json has no test script. Wire npm test (e.g. vitest) before delivery.",
    );
  }

  if (/\b(typescript|tsconfig|\.ts\b)/i.test(blob)) {
    const hasTs = tree.some((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
    if (!hasTs) {
      blockers.push(
        "Objective requires TypeScript but no .ts sources were delivered (JS-only stub is not enough).",
      );
    }
  }

  if (/\b(event\s*log|append-only|memory\s*record|retrieval|context\s*assembl)/i.test(blob)) {
    const joined = Object.values(contents).join("\n");
    const hasDomain =
      /\b(EventLog|MemoryEvent|MemoryRecord|InMemoryEventLog|append\s*\(|provenanceEventIds|ContextAssembler|RetrievalQuery)\b/.test(
        joined,
      ) || tree.some((file) => /event-log|memory-record|contracts|retriev|assembl/i.test(file));
    if (!hasDomain) {
      blockers.push(
        "Objective requires memory/event-log domain contracts, but delivery has no matching types or modules.",
      );
    }
  }

  if (isThinKeyValueStub(contents)) {
    blockers.push(
      "Delivery looks like a thin key-value Map stub (get/set only). That does not satisfy a foundation/module objective — implement real domain contracts and tests.",
    );
  }

  if (input.changedFiles.length === 0 && tree.filter((f) => /\.(js|ts)$/.test(f)).length === 0) {
    blockers.push("No source files were produced for a build objective.");
  }

  return blockers;
}
