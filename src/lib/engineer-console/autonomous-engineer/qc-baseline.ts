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

  const failFile = /FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)\s+>\s+(.+)/g;
  let match: RegExpExecArray | null;
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
