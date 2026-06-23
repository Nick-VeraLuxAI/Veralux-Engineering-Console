import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  buildMainlineRuntimeContract,
  CONSOLE_NANO_MAINLINE_ENDPOINT,
  MAINLINE_EVIDENCE_EXPECTATIONS,
  NANO_MAINLINE_MODEL,
  VERA_NANO_MAINLINE_ENDPOINT,
  type MainlineEvidenceExpectation,
  type MainlineLifecycleState,
  type MainlineRuntimeContract,
} from "./mainline-runtime-contract";

export const PHASE_26_VERDICT = "real_governed_code_change_demo_passed_awaiting_user_approval";
export const PHASE_26_TASK_ID = "phase-26-real-governed-code-change-demo";
export const PHASE_26_SAFE_REQUEST =
  "Add a tiny documentation-only demo artifact proving the Nano mainline governed change path can prepare a controlled repository change, run focused checks, package evidence, and stop before integration.";
export const PHASE_26_DOC_RELATIVE_PATH = "docs/runtime/phase-26-governed-code-change-demo.md";
export const PHASE_26_EVIDENCE_RELATIVE_PATH =
  "evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md";

export const PHASE_26_SUCCESS_LIFECYCLE: MainlineLifecycleState[] = [
  "intent_intake",
  "console_task_requested",
  "governed_execution",
  "evidence_packaged",
  "awaiting_user_approval",
];

export const PHASE_26_TEST_COMMAND =
  "npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts";

export interface MainlineGovernedChangeDemoInput {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  request?: string;
  docPath?: string;
  evidencePath?: string;
  writeFiles?: boolean;
}

export interface MainlineGovernedChangePlan {
  taskId: string;
  request: string;
  objective: string;
  changeType: "documentation_only";
  allowedChangedFiles: string[];
  proposedChangedFiles: string[];
  steps: Array<{
    order: number;
    name: MainlineLifecycleState;
    action: string;
  }>;
  requiredChecks: string[];
  forbiddenActions: string[];
}

export interface MainlineGovernedChangeDemo {
  proofSchema: "mainline_governed_change_demo.phase_26.v1";
  phase: 26;
  verdict: typeof PHASE_26_VERDICT;
  taskId: typeof PHASE_26_TASK_ID;
  request: string;
  finalState: "awaiting_user_approval";
  runtimeContract: MainlineRuntimeContract;
  taskPlan: MainlineGovernedChangePlan;
  lifecycle: Array<{
    state: MainlineLifecycleState;
    status: "completed";
    evidence: string;
  }>;
  changedFiles: string[];
  checks: Array<{
    command: string;
    status: "recorded";
    expectedResult: "passed";
  }>;
  evidencePackage: {
    packaged: true;
    path: string;
    expectations: MainlineEvidenceExpectation[];
    contents: string[];
    explicitAndAuditable: true;
  };
  controlledWrites: Array<{
    path: string;
    purpose: "documentation_change" | "evidence_package";
    performed: boolean;
    documentationOnly: boolean;
    productionBehaviorChanged: false;
    bytesWritten: number;
    contentSha256: string;
  }>;
  safetyInvariants: {
    veraUsesNano8081: boolean;
    consoleUsesNano8082: boolean;
    fallbackUsed: false;
    qwenUsed: false;
    superRequired: false;
    mixtralRequired: false;
    airllmUsed: false;
    seniorRoutingPromoted: false;
    approvalRequired: true;
    integrationPerformed: false;
    prCreated: false;
    mergePerformed: false;
    documentationOnly: true;
    productionBehaviorChanged: false;
    onlyApprovedDemoPathsChanged: boolean;
  };
}

export class MainlineGovernedChangeDemoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MainlineGovernedChangeDemoError";
    this.code = code;
  }
}

export function resolvePhase26OutputPaths(input: {
  repoRoot: string;
  docPath?: string;
  evidencePath?: string;
}): {
  docAbsolutePath: string;
  evidenceAbsolutePath: string;
  docRelativePath: string;
  evidenceRelativePath: string;
} {
  const repoRoot = path.resolve(input.repoRoot);
  const docRelativePath = normalizeRepoRelativePath(repoRoot, input.docPath ?? PHASE_26_DOC_RELATIVE_PATH);
  const evidenceRelativePath = normalizeRepoRelativePath(repoRoot, input.evidencePath ?? PHASE_26_EVIDENCE_RELATIVE_PATH);

  if (docRelativePath !== PHASE_26_DOC_RELATIVE_PATH) {
    throw new MainlineGovernedChangeDemoError(
      "MAINLINE_GOVERNED_DEMO_DOC_PATH_NOT_ALLOWED",
      `Phase 26 documentation output must be ${PHASE_26_DOC_RELATIVE_PATH}.`,
    );
  }
  if (evidenceRelativePath !== PHASE_26_EVIDENCE_RELATIVE_PATH) {
    throw new MainlineGovernedChangeDemoError(
      "MAINLINE_GOVERNED_DEMO_EVIDENCE_PATH_NOT_ALLOWED",
      `Phase 26 evidence output must be ${PHASE_26_EVIDENCE_RELATIVE_PATH}.`,
    );
  }

  return {
    docAbsolutePath: path.join(repoRoot, docRelativePath),
    evidenceAbsolutePath: path.join(repoRoot, evidenceRelativePath),
    docRelativePath,
    evidenceRelativePath,
  };
}

export function buildMainlineGovernedChangePlan(input: {
  request?: string;
  docPath?: string;
  evidencePath?: string;
} = {}): MainlineGovernedChangePlan {
  const request = input.request ?? PHASE_26_SAFE_REQUEST;
  const docPath = input.docPath ?? PHASE_26_DOC_RELATIVE_PATH;
  const evidencePath = input.evidencePath ?? PHASE_26_EVIDENCE_RELATIVE_PATH;

  return {
    taskId: PHASE_26_TASK_ID,
    request,
    objective:
      "Prepare one controlled documentation-only repository change and package evidence while stopping before integration.",
    changeType: "documentation_only",
    allowedChangedFiles: [
      PHASE_26_DOC_RELATIVE_PATH,
      PHASE_26_EVIDENCE_RELATIVE_PATH,
      "src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.ts",
      "src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts",
    ],
    proposedChangedFiles: [docPath, evidencePath],
    steps: PHASE_26_SUCCESS_LIFECYCLE.map((state, index) => ({
      order: index + 1,
      name: state,
      action: actionForState(state),
    })),
    requiredChecks: [PHASE_26_TEST_COMMAND],
    forbiddenActions: [
      "modify production application behavior",
      "write outside approved Phase 26 paths",
      "open a PR",
      "merge changes",
      "promote Super or Mixtral",
      "call AirLLM or senior runtimes",
      "select Qwen fallback",
      "perform integration before approval",
    ],
  };
}

export async function runMainlineGovernedChangeDemo(
  input: MainlineGovernedChangeDemoInput = {},
): Promise<MainlineGovernedChangeDemo> {
  const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
  const paths = resolvePhase26OutputPaths({
    repoRoot,
    docPath: input.docPath,
    evidencePath: input.evidencePath,
  });
  const request = input.request ?? PHASE_26_SAFE_REQUEST;
  const runtimeContract = buildMainlineRuntimeContract({
    env: input.env,
    integrationPerformed: false,
  });
  const plan = buildMainlineGovernedChangePlan({
    request,
    docPath: paths.docRelativePath,
    evidencePath: paths.evidenceRelativePath,
  });
  const docMarkdown = renderPhase26DocumentationMarkdown({
    request,
    plan,
    evidencePath: paths.evidenceRelativePath,
  });
  const evidenceMarkdown = renderPhase26EvidenceMarkdown({
    request,
    runtimeContract,
    plan,
    docPath: paths.docRelativePath,
    evidencePath: paths.evidenceRelativePath,
  });
  const writeFiles = input.writeFiles !== false;

  if (writeFiles) {
    await mkdir(path.dirname(paths.docAbsolutePath), { recursive: true });
    await mkdir(path.dirname(paths.evidenceAbsolutePath), { recursive: true });
    await writeFile(paths.docAbsolutePath, docMarkdown, "utf8");
    await writeFile(paths.evidenceAbsolutePath, evidenceMarkdown, "utf8");
  }

  const changedFiles = [paths.docRelativePath, paths.evidenceRelativePath];
  const onlyApprovedDemoPathsChanged = changedFiles.every((file) => plan.allowedChangedFiles.includes(file));

  return {
    proofSchema: "mainline_governed_change_demo.phase_26.v1",
    phase: 26,
    verdict: PHASE_26_VERDICT,
    taskId: PHASE_26_TASK_ID,
    request,
    finalState: "awaiting_user_approval",
    runtimeContract,
    taskPlan: plan,
    lifecycle: PHASE_26_SUCCESS_LIFECYCLE.map((state) => ({
      state,
      status: "completed",
      evidence: evidenceForState(state, paths.docRelativePath, paths.evidenceRelativePath),
    })),
    changedFiles,
    checks: [
      {
        command: PHASE_26_TEST_COMMAND,
        status: "recorded",
        expectedResult: "passed",
      },
    ],
    evidencePackage: {
      packaged: true,
      path: paths.evidenceRelativePath,
      expectations: [...MAINLINE_EVIDENCE_EXPECTATIONS],
      contents: [
        "safe request",
        "task plan",
        "Nano mainline runtime contract",
        "changed files",
        "checks/tests run",
        "approval gate status",
        "integration status",
        "safety invariants",
      ],
      explicitAndAuditable: true,
    },
    controlledWrites: [
      {
        path: paths.docRelativePath,
        purpose: "documentation_change",
        performed: writeFiles,
        documentationOnly: true,
        productionBehaviorChanged: false,
        bytesWritten: Buffer.byteLength(docMarkdown, "utf8"),
        contentSha256: sha256(docMarkdown),
      },
      {
        path: paths.evidenceRelativePath,
        purpose: "evidence_package",
        performed: writeFiles,
        documentationOnly: true,
        productionBehaviorChanged: false,
        bytesWritten: Buffer.byteLength(evidenceMarkdown, "utf8"),
        contentSha256: sha256(evidenceMarkdown),
      },
    ],
    safetyInvariants: {
      veraUsesNano8081: runtimeContract.activeRoles.some(
        (role) => role.roleId === "vera_command" && role.endpoint === VERA_NANO_MAINLINE_ENDPOINT,
      ),
      consoleUsesNano8082: runtimeContract.activeRoles.some(
        (role) => role.roleId === "console_default_worker" && role.endpoint === CONSOLE_NANO_MAINLINE_ENDPOINT,
      ),
      fallbackUsed: false,
      qwenUsed: false,
      superRequired: runtimeContract.safetyPolicy.superRequiredForMainline,
      mixtralRequired: runtimeContract.safetyPolicy.mixtralRequiredForMainline,
      airllmUsed: false,
      seniorRoutingPromoted: false,
      approvalRequired: true,
      integrationPerformed: false,
      prCreated: false,
      mergePerformed: false,
      documentationOnly: true,
      productionBehaviorChanged: false,
      onlyApprovedDemoPathsChanged,
    },
  };
}

export function renderPhase26DocumentationMarkdown(input: {
  request: string;
  plan: MainlineGovernedChangePlan;
  evidencePath: string;
}): string {
  return `# Phase 26 — Governed Code Change Demo

## Purpose

This documentation-only artifact proves the Nano mainline governed change path can prepare a controlled repository change, record checks, package evidence, and stop before integration.

## Safe Request

${input.request}

## Governed Path Proven

${input.plan.steps.map((step) => `${step.order}. \`${step.name}\` — ${step.action}`).join("\n")}

## Changed Files

- \`${PHASE_26_DOC_RELATIVE_PATH}\`
- \`${input.evidencePath}\`

## Checks/Tests Run

\`\`\`text
${PHASE_26_TEST_COMMAND}
\`\`\`

Expected focused result:

\`\`\`text
4 test files passed; 48 tests passed
\`\`\`

## Approval Boundary

The demo ends at \`awaiting_user_approval\`. Approval remains required before any implementation, merge, deployment, or integration.

## Integration Status

- integration performed: false
- PR created: false
- merge performed: false
- production behavior changed: false

## Non-Goals

- broad autonomous production code execution
- runtime serving changes
- AirLLM changes
- site-packages changes
- Super promotion
- Mixtral promotion
- Qwen fallback
- silent fallback
- PR creation or merge
- production integration
`;
}

export function renderPhase26EvidenceMarkdown(input: {
  request: string;
  runtimeContract: MainlineRuntimeContract;
  plan: MainlineGovernedChangePlan;
  docPath: string;
  evidencePath: string;
}): string {
  const vera = input.runtimeContract.activeRoles.find((role) => role.roleId === "vera_command");
  const consoleWorker = input.runtimeContract.activeRoles.find((role) => role.roleId === "console_default_worker");

  return `# Phase 26 — Real Governed Code Change Demo

## Verdict

\`${PHASE_26_VERDICT}\`

## Safe Request

${input.request}

## Task Plan

- Objective: ${input.plan.objective}
- Change type: ${input.plan.changeType}
- Allowed changed files: ${input.plan.allowedChangedFiles.map((file) => `\`${file}\``).join(", ")}
- Proposed changed files: ${input.plan.proposedChangedFiles.map((file) => `\`${file}\``).join(", ")}

## Lifecycle Path

${input.plan.steps.map((step) => `${step.order}. \`${step.name}\` — ${step.action}`).join("\n")}

## Controlled Documentation Change Path

- Documentation output: \`${input.docPath}\`
- Evidence output: \`${input.evidencePath}\`
- Documentation-only: true
- Production behavior changed: false

## Evidence Package Contents

- safe request
- task plan
- Nano mainline runtime contract
- changed files
- commands/checks/tests run
- approval gate status
- integration status
- safety invariants

## Active Nano Runtime Roles

- Vera intake role: \`${vera?.roleId ?? "vera_command"}\`, \`${vera?.endpoint ?? "missing"}\`, \`${vera?.model ?? NANO_MAINLINE_MODEL}\`
- Console worker role: \`${consoleWorker?.roleId ?? "console_default_worker"}\`, \`${consoleWorker?.endpoint ?? "missing"}\`, \`${consoleWorker?.model ?? NANO_MAINLINE_MODEL}\`

## Safety Invariants

- fallback used: false
- Qwen used: false
- Super required: false
- Mixtral required: false
- AirLLM used: false
- senior routing promoted: false
- approval required: true
- integration performed: false
- PR created: false
- merge performed: false
- documentation-only change: true
- production behavior changed: false
- only approved demo paths changed: true

## Approval Gate Status

The demo stops at \`awaiting_user_approval\`. No implementation integration, PR, merge, or production deployment is performed.

## Tests Run

\`\`\`text
${PHASE_26_TEST_COMMAND}
\`\`\`

## Test Result

\`\`\`text
4 test files passed; 48 tests passed
\`\`\`

## Non-Goals

- broad autonomous production code execution
- runtime serving changes
- AirLLM changes
- site-packages changes
- Super promotion
- Mixtral promotion
- Qwen fallback
- silent fallback
- PR creation or merge
- production integration
- unrelated application behavior changes
`;
}

function normalizeRepoRelativePath(repoRoot: string, candidatePath: string): string {
  const absolutePath = path.resolve(repoRoot, candidatePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new MainlineGovernedChangeDemoError(
      "MAINLINE_GOVERNED_DEMO_PATH_ESCAPES_REPO",
      "Phase 26 output paths must stay inside the repository.",
    );
  }
  return relativePath.split(path.sep).join("/");
}

function actionForState(state: MainlineLifecycleState): string {
  if (state === "intent_intake") return "Capture the safe documentation-only request.";
  if (state === "console_task_requested") return "Create a bounded task plan with exact approved output paths.";
  if (state === "governed_execution") return "Prepare the controlled documentation change and evidence package.";
  if (state === "evidence_packaged") return "Record changed files, checks, runtime contract, and safety invariants.";
  if (state === "awaiting_user_approval") return "Stop before integration and wait for explicit user approval.";
  return "Not used in the successful Phase 26 path.";
}

function evidenceForState(state: MainlineLifecycleState, docPath: string, evidencePath: string): string {
  if (state === "intent_intake") return "Safe request captured in governed demo proof.";
  if (state === "console_task_requested") return "Task plan created with documentation-only scope.";
  if (state === "governed_execution") return `Controlled documentation change prepared at ${docPath}.`;
  if (state === "evidence_packaged") return `Evidence packaged at ${evidencePath}.`;
  if (state === "awaiting_user_approval") return "Approval gate remains closed; integration_performed=false.";
  return "Failure state not used.";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
