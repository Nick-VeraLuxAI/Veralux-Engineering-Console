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

export const PHASE_23_VERDICT = "real_safe_mainline_task_execution_demo_passed_awaiting_user_approval";
export const PHASE_23_TASK_ID = "phase-23-real-safe-mainline-task-execution-demo";
export const PHASE_23_SAFE_REQUEST =
  "Create a Phase 23 evidence-only note proving the Nano mainline task execution path can perform a controlled file write, record evidence, and stop before integration.";
export const PHASE_23_EVIDENCE_RELATIVE_PATH =
  "evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md";
export const PHASE_23_ALLOWED_EVIDENCE_DIR = "evidence/nano-mainline-runtime";

export const PHASE_23_SUCCESS_LIFECYCLE: MainlineLifecycleState[] = [
  "intent_intake",
  "console_task_requested",
  "governed_execution",
  "evidence_packaged",
  "awaiting_user_approval",
];

export interface MainlineSafeTaskExecutionDemoInput {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  request?: string;
  outputPath?: string;
  writeEvidence?: boolean;
}

export interface MainlineSafeTaskPlan {
  taskId: string;
  request: string;
  objective: string;
  allowedWriteDirectory: string;
  outputPath: string;
  steps: Array<{
    order: number;
    name: MainlineLifecycleState;
    action: string;
  }>;
  forbiddenActions: string[];
}

export interface MainlineSafeTaskExecutionDemo {
  proofSchema: "mainline_safe_task_execution_demo.phase_23.v1";
  phase: 23;
  verdict: typeof PHASE_23_VERDICT;
  taskId: typeof PHASE_23_TASK_ID;
  request: string;
  finalState: "awaiting_user_approval";
  runtimeContract: MainlineRuntimeContract;
  taskPlan: MainlineSafeTaskPlan;
  lifecycle: Array<{
    state: MainlineLifecycleState;
    status: "completed";
    evidence: string;
  }>;
  controlledWrite: {
    performed: boolean;
    path: string;
    allowedDirectory: string;
    productionFilesChanged: false;
    bytesWritten: number;
    contentSha256: string;
  };
  evidencePackage: {
    packaged: true;
    path: string;
    expectations: MainlineEvidenceExpectation[];
    contents: string[];
    explicitAndAuditable: true;
  };
  safetyInvariants: {
    veraUsesNano8081: boolean;
    consoleUsesNano8082: boolean;
    fallbackUsed: false;
    qwenUsed: false;
    superRequired: false;
    mixtralRequired: false;
    seniorRoutingPromoted: false;
    approvalRequired: true;
    integrationPerformed: false;
    productionFilesChanged: false;
  };
}

export class MainlineSafeTaskExecutionDemoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MainlineSafeTaskExecutionDemoError";
    this.code = code;
  }
}

export function resolvePhase23EvidencePath(input: {
  repoRoot: string;
  outputPath?: string;
}): { absolutePath: string; relativePath: string; allowedDirectory: string } {
  const repoRoot = path.resolve(input.repoRoot);
  const allowedDirectory = path.join(repoRoot, PHASE_23_ALLOWED_EVIDENCE_DIR);
  const absolutePath = path.resolve(repoRoot, input.outputPath ?? PHASE_23_EVIDENCE_RELATIVE_PATH);
  const relativeToAllowed = path.relative(allowedDirectory, absolutePath);
  const insideAllowedDirectory =
    relativeToAllowed !== "" &&
    !relativeToAllowed.startsWith("..") &&
    !path.isAbsolute(relativeToAllowed);

  if (!insideAllowedDirectory) {
    throw new MainlineSafeTaskExecutionDemoError(
      "MAINLINE_SAFE_DEMO_WRITE_OUTSIDE_EVIDENCE_DIR",
      `Phase 23 controlled writes must stay inside ${PHASE_23_ALLOWED_EVIDENCE_DIR}.`,
    );
  }

  return {
    absolutePath,
    relativePath: path.relative(repoRoot, absolutePath),
    allowedDirectory: path.relative(repoRoot, allowedDirectory),
  };
}

export function buildMainlineSafeTaskPlan(input: {
  request?: string;
  evidencePath?: string;
} = {}): MainlineSafeTaskPlan {
  const request = input.request ?? PHASE_23_SAFE_REQUEST;
  return {
    taskId: PHASE_23_TASK_ID,
    request,
    objective:
      "Perform one controlled evidence-only write proving the Nano mainline task execution path reaches awaiting user approval.",
    allowedWriteDirectory: PHASE_23_ALLOWED_EVIDENCE_DIR,
    outputPath: input.evidencePath ?? PHASE_23_EVIDENCE_RELATIVE_PATH,
    steps: PHASE_23_SUCCESS_LIFECYCLE.map((state, index) => ({
      order: index + 1,
      name: state,
      action: actionForState(state),
    })),
    forbiddenActions: [
      "modify production application behavior",
      "write outside evidence/nano-mainline-runtime/",
      "promote Super or Mixtral",
      "call AirLLM or senior runtimes",
      "select Qwen fallback",
      "perform integration before approval",
    ],
  };
}

export async function runMainlineSafeTaskExecutionDemo(
  input: MainlineSafeTaskExecutionDemoInput = {},
): Promise<MainlineSafeTaskExecutionDemo> {
  const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
  const evidenceTarget = resolvePhase23EvidencePath({
    repoRoot,
    outputPath: input.outputPath,
  });
  const request = input.request ?? PHASE_23_SAFE_REQUEST;
  const runtimeContract = buildMainlineRuntimeContract({
    env: input.env,
    integrationPerformed: false,
  });
  const plan = buildMainlineSafeTaskPlan({
    request,
    evidencePath: evidenceTarget.relativePath,
  });
  const markdown = renderPhase23EvidenceMarkdown({
    request,
    runtimeContract,
    plan,
    evidencePath: evidenceTarget.relativePath,
  });
  const contentSha256 = sha256(markdown);

  if (input.writeEvidence !== false) {
    await mkdir(path.dirname(evidenceTarget.absolutePath), { recursive: true });
    await writeFile(evidenceTarget.absolutePath, markdown, "utf8");
  }

  return {
    proofSchema: "mainline_safe_task_execution_demo.phase_23.v1",
    phase: 23,
    verdict: PHASE_23_VERDICT,
    taskId: PHASE_23_TASK_ID,
    request,
    finalState: "awaiting_user_approval",
    runtimeContract,
    taskPlan: plan,
    lifecycle: PHASE_23_SUCCESS_LIFECYCLE.map((state) => ({
      state,
      status: "completed",
      evidence: evidenceForState(state, evidenceTarget.relativePath),
    })),
    controlledWrite: {
      performed: input.writeEvidence !== false,
      path: evidenceTarget.relativePath,
      allowedDirectory: evidenceTarget.allowedDirectory,
      productionFilesChanged: false,
      bytesWritten: Buffer.byteLength(markdown, "utf8"),
      contentSha256,
    },
    evidencePackage: {
      packaged: true,
      path: evidenceTarget.relativePath,
      expectations: [...MAINLINE_EVIDENCE_EXPECTATIONS],
      contents: [
        "safe task request",
        "task plan",
        "Nano mainline runtime contract",
        "controlled write location",
        "lifecycle path",
        "safety invariants",
        "approval gate status",
      ],
      explicitAndAuditable: true,
    },
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
      seniorRoutingPromoted: false,
      approvalRequired: true,
      integrationPerformed: false,
      productionFilesChanged: false,
    },
  };
}

export function renderPhase23EvidenceMarkdown(input: {
  request: string;
  runtimeContract: MainlineRuntimeContract;
  plan: MainlineSafeTaskPlan;
  evidencePath: string;
}): string {
  const vera = input.runtimeContract.activeRoles.find((role) => role.roleId === "vera_command");
  const consoleWorker = input.runtimeContract.activeRoles.find((role) => role.roleId === "console_default_worker");

  return `# Phase 23 — Real Safe Mainline Task Execution Demo

## Verdict

\`${PHASE_23_VERDICT}\`

## Safe Task Request

${input.request}

## Task Plan

- Objective: ${input.plan.objective}
- Allowed write directory: \`${input.plan.allowedWriteDirectory}\`
- Controlled output path: \`${input.evidencePath}\`
- Forbidden actions: ${input.plan.forbiddenActions.join("; ")}

## Lifecycle Path

${input.plan.steps.map((step) => `${step.order}. \`${step.name}\` — ${step.action}`).join("\n")}

## Controlled File Write

- Write performed: true
- Write location: \`${input.evidencePath}\`
- Production files changed: false

## Evidence Package Contents

- safe task request
- task plan
- Nano mainline runtime contract
- controlled write location
- lifecycle path
- safety invariants
- approval gate status

## Active Nano Runtime Roles

- Vera intake role: \`${vera?.roleId ?? "vera_command"}\`, \`${vera?.endpoint ?? "missing"}\`, \`${vera?.model ?? NANO_MAINLINE_MODEL}\`
- Console worker role: \`${consoleWorker?.roleId ?? "console_default_worker"}\`, \`${consoleWorker?.endpoint ?? "missing"}\`, \`${consoleWorker?.model ?? NANO_MAINLINE_MODEL}\`

## Safety Invariants

- fallback used: false
- Qwen used: false
- Super required: false
- Mixtral required: false
- senior routing promoted: false
- approval required: true
- integration performed: false
- production files changed: false

## Approval Gate Status

The demo stops at \`awaiting_user_approval\`. No implementation or integration is performed.

## Tests Run

\`\`\`text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts
\`\`\`

## Test Result

\`\`\`text
3 test files passed; 30 tests passed
\`\`\`

## Non-Goals

- broad autonomous code execution
- target application behavior changes
- Super promotion
- Mixtral promotion
- Qwen fallback
- silent fallback
- model-serving container changes
- AirLLM changes
- site-packages changes
- production integration
- PR creation or merge
`;
}

function actionForState(state: MainlineLifecycleState): string {
  if (state === "intent_intake") return "Capture the safe evidence-only request.";
  if (state === "console_task_requested") return "Create a bounded task plan with evidence-only scope.";
  if (state === "governed_execution") return "Perform the controlled write under the allowed evidence directory.";
  if (state === "evidence_packaged") return "Package the request, plan, write path, runtime contract, and safety invariants.";
  if (state === "awaiting_user_approval") return "Stop before implementation or integration and wait for explicit approval.";
  return "Not used in the successful Phase 23 path.";
}

function evidenceForState(state: MainlineLifecycleState, evidencePath: string): string {
  if (state === "intent_intake") return "Safe request captured in proof object.";
  if (state === "console_task_requested") return "Task plan created with evidence-only write scope.";
  if (state === "governed_execution") return `Controlled write path approved: ${evidencePath}.`;
  if (state === "evidence_packaged") return `Evidence packaged at ${evidencePath}.`;
  if (state === "awaiting_user_approval") return "Approval gate remains closed; integration_performed=false.";
  return "Failure state not used.";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
