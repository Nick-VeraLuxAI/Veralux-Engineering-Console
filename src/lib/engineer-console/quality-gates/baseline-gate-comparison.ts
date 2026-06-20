import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { runQualityGateCommand, type QualityGateCommandResult } from "./quality-gate-runner";
import { createDetachedWorktree, removeWorktree } from "../project-orchestration/controlled-workspace-git";

export type GateComparisonVerdict =
  | "PASS"
  | "PASS_WITH_BASELINE_DEBT"
  | "FAIL_NEW_REGRESSION"
  | "FAIL_WORSENED_BASELINE"
  | "FAIL_GATE_UNAVAILABLE"
  | "FAIL_COMPARISON_INDETERMINATE";

export interface NormalizedGateFinding {
  gate: "typecheck" | "lint" | "test" | "build" | "unknown";
  filePath: string | null;
  line: number | null;
  column: number | null;
  code: string | null;
  ruleId: string | null;
  severity: string | null;
  message: string;
  fingerprint: string;
}

export interface BaselineGateResult {
  gateName: string;
  command: string;
  commit: string;
  workspacePath: string;
  exitCode: number;
  status: QualityGateCommandResult["status"];
  stdout: string;
  stderr: string;
  normalizedFindings: NormalizedGateFinding[];
  startedAt: string;
  completedAt: string;
}

export interface CandidateGateResult extends BaselineGateResult {
  touchedFiles: string[];
}

export interface GateComparisonResult {
  gateName: string;
  command: string;
  baseline: BaselineGateResult;
  candidate: CandidateGateResult;
  newFindings: NormalizedGateFinding[];
  resolvedFindings: NormalizedGateFinding[];
  worsenedFindings: NormalizedGateFinding[];
  unchangedFindings: NormalizedGateFinding[];
  touchedFileFindings: NormalizedGateFinding[];
  verdict: GateComparisonVerdict;
  warning: string | null;
  comparedAt: string;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function repoRelativePath(rawPath: string, repoPath?: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  if (repoPath) {
    const root = path.resolve(repoPath).replace(/\\/g, "/");
    if (normalized.startsWith(root + "/")) return normalized.slice(root.length + 1);
  }
  const tmpIndex = normalized.lastIndexOf("/src/");
  if (tmpIndex >= 0) return normalized.slice(tmpIndex + 1);
  return normalized.replace(/^file:\/\//, "").replace(/^\.\//, "");
}

function normalizeMessage(value: string, repoPath?: string): string {
  let message = stripAnsi(value);
  if (repoPath) {
    message = message.split(path.resolve(repoPath)).join("<repo>");
  }
  return message
    .replace(/\/tmp\/[^\s)]+/g, "<tmp>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[^\s]+/g, "<timestamp>")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(finding: Omit<NormalizedGateFinding, "fingerprint">): string {
  return [
    finding.gate,
    finding.filePath ?? "",
    finding.line ?? "",
    finding.column ?? "",
    finding.code ?? "",
    finding.ruleId ?? "",
    finding.severity ?? "",
    finding.message,
  ].join("|");
}

function makeFinding(input: Omit<NormalizedGateFinding, "fingerprint">): NormalizedGateFinding {
  return { ...input, fingerprint: fingerprint(input) };
}

function gateNameForCommand(command: string): NormalizedGateFinding["gate"] {
  const lower = command.toLowerCase();
  if (lower.includes("typecheck") || lower.includes("tsc")) return "typecheck";
  if (lower.includes("lint") || lower.includes("eslint")) return "lint";
  if (lower.includes("test") || lower.includes("vitest") || lower.includes("jest")) return "test";
  if (lower.includes("build")) return "build";
  return "unknown";
}

export function normalizeGateFindings(input: {
  command: string;
  stdout: string;
  stderr: string;
  repoPath?: string;
}): NormalizedGateFinding[] {
  const gate = gateNameForCommand(input.command);
  const text = stripAnsi([input.stdout, input.stderr].filter(Boolean).join("\n"));
  const findings: NormalizedGateFinding[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let finding: NormalizedGateFinding | null = null;
    const ts = line.match(/^(.*?\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/);
    if (ts) {
      finding = makeFinding({
        gate,
        filePath: repoRelativePath(ts[1], input.repoPath),
        line: Number(ts[2]),
        column: Number(ts[3]),
        code: ts[4],
        ruleId: null,
        severity: "error",
        message: normalizeMessage(ts[5], input.repoPath),
      });
    }

    const eslint = line.match(/^(.*?\.(?:ts|tsx|js|jsx)):(\d+):(\d+)\s+(error|warning)\s+(.*?)\s+([@\w/-]+)$/);
    if (!finding && eslint) {
      finding = makeFinding({
        gate,
        filePath: repoRelativePath(eslint[1], input.repoPath),
        line: Number(eslint[2]),
        column: Number(eslint[3]),
        code: null,
        ruleId: eslint[6],
        severity: eslint[4],
        message: normalizeMessage(eslint[5], input.repoPath),
      });
    }

    if (!finding && /(error|failed|exception|cannot|unable)/i.test(line)) {
      finding = makeFinding({
        gate,
        filePath: null,
        line: null,
        column: null,
        code: null,
        ruleId: null,
        severity: "error",
        message: normalizeMessage(line, input.repoPath),
      });
    }

    if (finding && !seen.has(finding.fingerprint)) {
      seen.add(finding.fingerprint);
      findings.push(finding);
    }
  }

  return findings.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

function sameRootFinding(a: NormalizedGateFinding, b: NormalizedGateFinding): boolean {
  return a.gate === b.gate && a.filePath === b.filePath && (a.code ?? a.ruleId) === (b.code ?? b.ruleId);
}

export function compareGateFindings(input: {
  command: string;
  baseline: BaselineGateResult;
  candidate: CandidateGateResult;
  policyAllowsBaselineDebt?: boolean;
  focusedTestsPassed?: boolean;
}): GateComparisonResult {
  const baselineByFingerprint = new Map(input.baseline.normalizedFindings.map((finding) => [finding.fingerprint, finding]));
  const candidateByFingerprint = new Map(input.candidate.normalizedFindings.map((finding) => [finding.fingerprint, finding]));
  const newFindings = input.candidate.normalizedFindings.filter(
    (finding) => !baselineByFingerprint.has(finding.fingerprint),
  );
  const resolvedFindings = input.baseline.normalizedFindings.filter(
    (finding) => !candidateByFingerprint.has(finding.fingerprint),
  );
  const unchangedFindings = input.candidate.normalizedFindings.filter((finding) =>
    baselineByFingerprint.has(finding.fingerprint),
  );
  const worsenedFindings = newFindings.filter((finding) =>
    input.baseline.normalizedFindings.some((baseline) => sameRootFinding(baseline, finding)),
  );
  const touched = new Set(input.candidate.touchedFiles.map((file) => file.replace(/\\/g, "/")));
  const touchedFileFindings = newFindings.filter((finding) => finding.filePath && touched.has(finding.filePath));

  let verdict: GateComparisonVerdict = "FAIL_COMPARISON_INDETERMINATE";
  let warning: string | null = null;
  if (input.candidate.status === "passed") {
    verdict = "PASS";
  } else if (input.baseline.status === "passed") {
    verdict = "FAIL_NEW_REGRESSION";
  } else if (input.baseline.status === "skipped" || input.candidate.status === "skipped") {
    verdict = "FAIL_GATE_UNAVAILABLE";
  } else if (worsenedFindings.length > 0) {
    verdict = "FAIL_WORSENED_BASELINE";
  } else if (newFindings.length > 0 || touchedFileFindings.length > 0) {
    verdict = "FAIL_NEW_REGRESSION";
  } else if (!input.policyAllowsBaselineDebt || !input.focusedTestsPassed) {
    verdict = "FAIL_COMPARISON_INDETERMINATE";
  } else {
    verdict = "PASS_WITH_BASELINE_DEBT";
    warning = `Candidate introduced no new ${input.command} findings; repository retains ${unchangedFindings.length} pre-existing baseline findings.`;
  }

  return {
    gateName: gateNameForCommand(input.command),
    command: input.command,
    baseline: input.baseline,
    candidate: input.candidate,
    newFindings,
    resolvedFindings,
    worsenedFindings,
    unchangedFindings,
    touchedFileFindings,
    verdict,
    warning,
    comparedAt: new Date().toISOString(),
  };
}

function linkNodeModules(sourceRepoPath: string, targetRepoPath: string): void {
  const source = path.join(sourceRepoPath, "node_modules");
  const target = path.join(targetRepoPath, "node_modules");
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.symlinkSync(source, target, "dir");
}

export async function compareCommandAgainstBaseline(input: {
  repoPath: string;
  baseCommit: string;
  candidateCommit: string;
  candidateWorkspacePath: string;
  workspaceRoot?: string;
  command: string;
  touchedFiles: string[];
  policyAllowsBaselineDebt?: boolean;
  focusedTestsPassed?: boolean;
}): Promise<GateComparisonResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? path.join(os.tmpdir(), "veralux-engineering-workspaces"));
  const baselinePath = path.join(workspaceRoot, `baseline-gate-${uuidv4()}`);
  const startedAt = new Date().toISOString();
  await createDetachedWorktree({
    repoPath: input.repoPath,
    worktreePath: baselinePath,
    commit: input.baseCommit,
    workspaceRoot,
  });
  try {
    linkNodeModules(input.candidateWorkspacePath, baselinePath);
    const baselineRaw = await runQualityGateCommand(baselinePath, input.command);
    const baselineCompletedAt = new Date().toISOString();
    const candidateRaw = await runQualityGateCommand(input.candidateWorkspacePath, input.command);
    const candidateCompletedAt = new Date().toISOString();
    const baseline: BaselineGateResult = {
      gateName: gateNameForCommand(input.command),
      command: input.command,
      commit: input.baseCommit,
      workspacePath: baselinePath,
      exitCode: baselineRaw.exitCode,
      status: baselineRaw.status,
      stdout: baselineRaw.stdout,
      stderr: baselineRaw.stderr,
      normalizedFindings: normalizeGateFindings({ command: input.command, stdout: baselineRaw.stdout, stderr: baselineRaw.stderr, repoPath: baselinePath }),
      startedAt,
      completedAt: baselineCompletedAt,
    };
    const candidate: CandidateGateResult = {
      gateName: gateNameForCommand(input.command),
      command: input.command,
      commit: input.candidateCommit,
      workspacePath: input.candidateWorkspacePath,
      exitCode: candidateRaw.exitCode,
      status: candidateRaw.status,
      stdout: candidateRaw.stdout,
      stderr: candidateRaw.stderr,
      normalizedFindings: normalizeGateFindings({ command: input.command, stdout: candidateRaw.stdout, stderr: candidateRaw.stderr, repoPath: input.candidateWorkspacePath }),
      touchedFiles: input.touchedFiles,
      startedAt: baselineCompletedAt,
      completedAt: candidateCompletedAt,
    };
    return compareGateFindings({
      command: input.command,
      baseline,
      candidate,
      policyAllowsBaselineDebt: input.policyAllowsBaselineDebt,
      focusedTestsPassed: input.focusedTestsPassed,
    });
  } finally {
    await removeWorktree(input.repoPath, baselinePath).catch(() => undefined);
  }
}
