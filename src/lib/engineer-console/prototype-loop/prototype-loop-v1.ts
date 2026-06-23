import { execFile } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  evaluateAcceptanceThreshold,
  type AcceptanceCriterionStatus,
  type AcceptanceThresholdGate,
  type AcceptanceThresholdVerdict,
} from "./acceptance-threshold";

const execFileAsync = promisify(execFile);

export type EvidenceStatus = "ready_for_user_approval" | "passed_with_skips" | "requires_revision" | "blocked" | "failed";

export interface PrototypeLoopConsoleAssignment {
  assignment_type: "prototype_loop_v1_console_build";
  task_id: string;
  objective: string;
  acceptance_criteria: string[];
  test_expectations: string[];
  allowed_file_scope: string[];
  risk_level: "low" | "medium" | "high" | string;
  evidence_requirements: string[];
  approval_policy: {
    approval_required: boolean;
    integration_allowed: boolean;
    implementation_policy: string;
  };
  loop_limits: {
    max_implementation_loops: number;
    max_repair_attempts_per_failing_gate: number;
    max_revision_rounds: number;
  };
  model_role_requirements: Record<string, Record<string, unknown>>;
  structured_build_request: Record<string, unknown> & {
    original_user_request?: string;
    clarification_behavior?: Record<string, unknown>;
  };
}

export interface PrototypeLoopCommandResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PrototypeLoopEvidence {
  task_id: string;
  timestamp: string;
  original_user_request: string;
  vera_clarification_questions_or_safe_default_rationale: unknown;
  structured_build_request: Record<string, unknown>;
  console_assignment: PrototypeLoopConsoleAssignment;
  files_created_or_changed: string[];
  patch_diff_summary: string;
  commands_run: string[];
  test_results: PrototypeLoopCommandResult[];
  lint_typecheck_results: PrototypeLoopCommandResult[];
  secret_scan_result: {
    status: "passed" | "failed";
    files_scanned: string[];
    findings: string[];
  };
  diff_scope_check: {
    status: "passed" | "failed";
    allowed_scope: string[];
    checked_files: string[];
    unexpected_files: string[];
  };
  gates: Array<{ name: string; status: "passed" | "failed"; message: string }>;
  risk_assessment: string;
  unresolved_issues: string[];
  final_readiness_status: EvidenceStatus;
  status: EvidenceStatus;
  readiness_status: AcceptanceThresholdVerdict["readiness_status"];
  implementation_recommendation: string;
  approval_required: boolean;
  integration_allowed: boolean;
  integration_performed: boolean;
  workspace_path: string;
  evidence_path: string;
  what_was_created: string;
  tests_passed: boolean;
  repair_attempts: number;
  revision_rounds: Array<{
    reason_for_revision: string;
    requested_change: string;
    console_response: string;
    new_evidence_status: EvidenceStatus;
  }>;
  acceptance_threshold: AcceptanceThresholdVerdict;
  threshold_engine_input: AcceptanceThresholdVerdict["threshold_input"];
  threshold_engine_gates: AcceptanceThresholdGate[];
  threshold_engine_output: AcceptanceThresholdVerdict;
  readiness_verdict: AcceptanceThresholdVerdict["status"];
  gate_results: AcceptanceThresholdVerdict["gate_results"];
  required_gates: string[];
  passed_gates: string[];
  failed_gates: string[];
  skipped_gates: string[];
  not_applicable_gates: AcceptanceThresholdVerdict["not_applicable_gates"];
  pre_existing_unrelated_failures: AcceptanceThresholdVerdict["pre_existing_unrelated_failures"];
  blocking_failures: string[];
  blocking_reasons: string[];
}

interface PrototypeLoopOptions {
  repoRoot?: string;
  workspaceRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeLoopCommandResult>;
}

const CLI_FILE = "word-count-cli.mjs";
const TEST_FILE = "word-count-cli.test.mjs";
const SAMPLE_FILE = "sample.txt";
const SECRET_PATTERN = /\b(api[_-]?key|secret|token|password)\b\s*[:=]/i;

export async function runPrototypeLoopV1(
  assignment: PrototypeLoopConsoleAssignment,
  options: PrototypeLoopOptions = {},
): Promise<PrototypeLoopEvidence> {
  validateConsoleAssignment(assignment);
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const workspaceRoot = path.resolve(options.workspaceRoot ?? path.join(repoRoot, ".prototype-loop"));
  const evidenceRoot = path.resolve(options.evidenceRoot ?? path.join(repoRoot, "evidence", "prototype-loop-v1"));
  const workspacePath = path.join(workspaceRoot, assignment.task_id);
  assertChildPath(workspaceRoot, workspacePath);

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(evidenceRoot, { recursive: true });
  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(workspacePath, { recursive: true });

  const filesCreated = await writeWordCountPrototype(workspacePath);
  const maxAttempts = Math.max(1, assignment.loop_limits.max_repair_attempts_per_failing_gate + 1);
  const testResults: PrototypeLoopCommandResult[] = [];
  let testsPassed = false;
  let repairAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runCommand(workspacePath, "node --test word-count-cli.test.mjs", options.commandRunner);
    testResults.push(result);
    testsPassed = result.status === "passed";
    if (testsPassed) break;
    repairAttempts += 1;
    await writeWordCountPrototype(workspacePath);
  }

  const filesRelative = filesCreated.map((file) => path.relative(repoRoot, file));
  const secretScan = await scanCreatedFilesForSecrets(filesCreated);
  const diffScope = checkDiffScope(filesCreated, workspacePath, assignment.allowed_file_scope);
  const lintTypecheckResults: PrototypeLoopCommandResult[] = [
    {
      command: "(not applicable)",
      status: "skipped",
      exitCode: 0,
      stdout: "",
      stderr: "Prototype workspace has no package-level lint/typecheck/build configuration.",
      durationMs: 0,
    },
  ];
  const gates = [
    {
      name: "prototype_tests",
      status: testsPassed ? "passed" as const : "failed" as const,
      message: testsPassed ? "node --test passed" : "prototype test gate failed",
    },
    {
      name: "diff_scope",
      status: diffScope.status,
      message: diffScope.unexpected_files.length === 0 ? "all changes are inside the prototype workspace" : "unexpected files changed",
    },
    {
      name: "secret_scan",
      status: secretScan.status,
      message: secretScan.findings.length === 0 ? "no obvious secret patterns found" : "secret-like patterns found",
    },
    {
      name: "approval_required",
      status: assignment.approval_policy.approval_required && !assignment.approval_policy.integration_allowed ? "passed" as const : "failed" as const,
      message: "implementation is blocked pending explicit user approval",
    },
  ];
  const evidencePath = path.join(evidenceRoot, `${assignment.task_id}.json`);
  const acceptanceCriteriaStatuses = buildAcceptanceCriteriaStatuses(assignment, testsPassed);
  const acceptanceThreshold = evaluateAcceptanceThreshold({
    taskId: assignment.task_id,
    riskLevel: assignment.risk_level,
    riskNotes: ["Isolated local CLI prototype; no production integration performed."],
    acceptanceCriteriaStatuses,
    prototypeWorkspacePath: workspacePath,
    requiredTestsConfigured: assignment.test_expectations.length > 0,
    approvalRequired: assignment.approval_policy.approval_required,
    integrationAllowed: assignment.approval_policy.integration_allowed,
    integrationPerformed: false,
    evidenceBundleGenerated: true,
    filesCreatedOrChanged: filesRelative,
    testResults,
    lintTypecheckResults,
    diffScopeCheck: diffScope,
    secretScanResult: secretScan,
    modelRoleRequirements: assignment.model_role_requirements,
    fallbackUsed: false,
    seniorUsed: false,
    preExistingUnrelatedFailures: [],
  });
  const approvalAllowed = acceptanceThreshold.approval_allowed;
  const evidence: PrototypeLoopEvidence = {
    task_id: assignment.task_id,
    timestamp: (options.now ?? new Date()).toISOString(),
    original_user_request: String(assignment.structured_build_request.original_user_request ?? ""),
    vera_clarification_questions_or_safe_default_rationale:
      assignment.structured_build_request.clarification_behavior ?? {},
    structured_build_request: assignment.structured_build_request,
    console_assignment: assignment,
    files_created_or_changed: filesRelative,
    patch_diff_summary: summarizePrototypeFiles(filesCreated),
    commands_run: testResults.map((result) => result.command),
    test_results: testResults,
    lint_typecheck_results: lintTypecheckResults,
    secret_scan_result: secretScan,
    diff_scope_check: diffScope,
    gates,
    risk_assessment: "Low: isolated local CLI prototype, no network dependency, no production integration.",
    unresolved_issues: acceptanceThreshold.unresolved_issues,
    final_readiness_status: acceptanceThreshold.status,
    status: acceptanceThreshold.status,
    readiness_status: acceptanceThreshold.readiness_status,
    implementation_recommendation: approvalAllowed
      ? "Keep as prototype until the user explicitly approves implementation."
      : "Revise the prototype evidence before asking for implementation approval.",
    approval_required: assignment.approval_policy.approval_required,
    integration_allowed: assignment.approval_policy.integration_allowed,
    integration_performed: false,
    workspace_path: workspacePath,
    evidence_path: evidencePath,
    what_was_created: "A tiny Node.js CLI that analyzes a text file and reports word count, character count, and the top 5 repeated words.",
    tests_passed: testsPassed,
    repair_attempts: repairAttempts,
    revision_rounds: [],
    acceptance_threshold: acceptanceThreshold,
    threshold_engine_input: acceptanceThreshold.threshold_input,
    threshold_engine_gates: acceptanceThreshold.normalized_gates,
    threshold_engine_output: acceptanceThreshold,
    readiness_verdict: acceptanceThreshold.status,
    gate_results: acceptanceThreshold.gate_results,
    required_gates: acceptanceThreshold.required_gates,
    passed_gates: acceptanceThreshold.passed_gates,
    failed_gates: acceptanceThreshold.failed_gates,
    skipped_gates: acceptanceThreshold.skipped_gates,
    not_applicable_gates: acceptanceThreshold.not_applicable_gates,
    pre_existing_unrelated_failures: acceptanceThreshold.pre_existing_unrelated_failures,
    blocking_failures: acceptanceThreshold.blocking_failures,
    blocking_reasons: acceptanceThreshold.blocking_reasons,
  };

  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidence;
}

function buildAcceptanceCriteriaStatuses(
  assignment: PrototypeLoopConsoleAssignment,
  testsPassed: boolean,
): AcceptanceCriterionStatus[] {
  return assignment.acceptance_criteria.map((criterion) => ({
    criterion,
    status: testsPassed ? "passed" : "failed",
    evidence: testsPassed
      ? "Satisfied by isolated prototype files, command results, safety checks, generated evidence, and approval policy."
      : "Prototype tests did not pass; see command and gate results.",
  }));
}

export function validateConsoleAssignment(assignment: PrototypeLoopConsoleAssignment): void {
  if (assignment.assignment_type !== "prototype_loop_v1_console_build") {
    throw new Error("PROTOTYPE_LOOP_INVALID_ASSIGNMENT_TYPE");
  }
  if (!assignment.approval_policy.approval_required || assignment.approval_policy.integration_allowed) {
    throw new Error("PROTOTYPE_LOOP_APPROVAL_POLICY_VIOLATION");
  }
  const vera = assignment.model_role_requirements.vera ?? {};
  const consoleRole = assignment.model_role_requirements.console ?? {};
  const senior = assignment.model_role_requirements.senior ?? {};
  const serializedRoles = JSON.stringify(assignment.model_role_requirements).toLowerCase();
  if (serializedRoles.includes("qwen")) {
    throw new Error("PROTOTYPE_LOOP_QWEN_ROUTE_FORBIDDEN");
  }
  if (vera.repository_write_allowed !== false) {
    throw new Error("PROTOTYPE_LOOP_VERA_WRITE_FORBIDDEN");
  }
  if (consoleRole.fallback_allowed !== false) {
    throw new Error("PROTOTYPE_LOOP_CONSOLE_FALLBACK_FORBIDDEN");
  }
  if (senior.status !== "blocked_unproven") {
    throw new Error("PROTOTYPE_LOOP_SENIOR_MUST_REMAIN_BLOCKED");
  }
}

async function writeWordCountPrototype(workspacePath: string): Promise<string[]> {
  const cliPath = path.join(workspacePath, CLI_FILE);
  const testPath = path.join(workspacePath, TEST_FILE);
  const samplePath = path.join(workspacePath, SAMPLE_FILE);
  await fs.writeFile(cliPath, cliSource(), "utf8");
  await fs.writeFile(testPath, testSource(), "utf8");
  await fs.writeFile(samplePath, "Hello hello world. Vera builds builds tiny tiny tiny tools.\n", "utf8");
  return [cliPath, testPath, samplePath];
}

function cliSource(): string {
  return `#!/usr/bin/env node
import fs from "node:fs";

export function analyzeText(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const topRepeatedWords = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
  return {
    wordCount: words.length,
    characterCount: text.length,
    topRepeatedWords,
  };
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: word-count-cli.mjs <text-file>");
    process.exit(2);
  }
  const text = fs.readFileSync(inputPath, "utf8");
  console.log(JSON.stringify(analyzeText(text), null, 2));
}
`;
}

function testSource(): string {
  return `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { analyzeText } from "./word-count-cli.mjs";

const sample = fs.readFileSync("./sample.txt", "utf8");

test("analyzeText reports counts and top repeated words", () => {
  assert.deepEqual(analyzeText(sample), {
    wordCount: 10,
    characterCount: sample.length,
    topRepeatedWords: [
      { word: "tiny", count: 3 },
      { word: "builds", count: 2 },
      { word: "hello", count: 2 },
      { word: "tools", count: 1 },
      { word: "vera", count: 1 },
    ],
  });
});

test("CLI prints JSON analysis for a file path", () => {
  const output = execFileSync(process.execPath, ["./word-count-cli.mjs", "./sample.txt"], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  assert.equal(parsed.wordCount, 10);
  assert.equal(parsed.characterCount, sample.length);
  assert.equal(parsed.topRepeatedWords[0].word, "tiny");
});
`;
}

async function runCommand(
  cwd: string,
  command: string,
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeLoopCommandResult>,
): Promise<PrototypeLoopCommandResult> {
  if (commandRunner) return commandRunner(cwd, command);
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--test", TEST_FILE], {
      cwd,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });
    return {
      command,
      status: "passed",
      exitCode: 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      command,
      status: "failed",
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
      durationMs: Date.now() - started,
    };
  }
}

async function scanCreatedFilesForSecrets(files: string[]): Promise<PrototypeLoopEvidence["secret_scan_result"]> {
  const findings: string[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    if (SECRET_PATTERN.test(content)) {
      findings.push(file);
    }
  }
  return {
    status: findings.length === 0 ? "passed" : "failed",
    files_scanned: files,
    findings,
  };
}

function checkDiffScope(
  files: string[],
  workspacePath: string,
  allowedScope: string[],
): PrototypeLoopEvidence["diff_scope_check"] {
  const normalizedWorkspace = path.resolve(workspacePath);
  const unexpected = files.filter((file) => !isChildPath(normalizedWorkspace, path.resolve(file)));
  return {
    status: unexpected.length === 0 ? "passed" : "failed",
    allowed_scope: allowedScope,
    checked_files: files,
    unexpected_files: unexpected,
  };
}

function summarizePrototypeFiles(files: string[]): string {
  const digest = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
  return `Created ${files.length} isolated prototype files for the word-count CLI. file_set_sha256=${digest}`;
}

function assertChildPath(parent: string, child: string): void {
  if (!isChildPath(parent, child)) {
    throw new Error("PROTOTYPE_LOOP_WORKSPACE_SCOPE_VIOLATION");
  }
}

function isChildPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
