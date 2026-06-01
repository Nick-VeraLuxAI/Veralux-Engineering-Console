import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  auditHermesQualityGateFailed,
  auditHermesQualityGatePassed,
  auditHermesQualityGateStarted,
  auditHermesQualityGatesCompleted,
  auditHermesQualityGatesRequested,
} from "../governance/audit-ledger/hermes-quality-gate-audit-lifecycle";
import { runBoundedCommand } from "./hermes-bounded-command-runner";
import {
  commandForHermesQualityGateId,
  execSpecForHermesQualityGateId,
  type HermesQualityGateId,
} from "./hermes-quality-gate-definitions";
import { insertHermesQualityGateRun } from "./hermes-quality-gate-run-manager";
import {
  HermesQualityGateRunError,
  validateHermesQualityGatesForRun,
  type OperatorQualityGateApproval,
} from "./validate-hermes-quality-gates-for-run";

export { HermesQualityGateRunError } from "./validate-hermes-quality-gates-for-run";

export const HERMES_QUALITY_GATE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface HermesQualityGateRunResultItem {
  gateId: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  artifactPath: string;
  stdoutArtifactPath: string;
  stderrArtifactPath: string;
  timedOut: boolean;
}

function readPackageScripts(repoPath: string): Record<string, string> {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function scriptExistsForGate(scripts: Record<string, string>, gateId: HermesQualityGateId): boolean {
  if (gateId === "test") return Boolean(scripts.test);
  return Boolean(scripts[gateId]);
}

function computeOverallStatus(
  results: HermesQualityGateRunResultItem[],
): "passed" | "failed" | "partial" {
  const ran = results.filter((r) => r.status !== "skipped");
  if (ran.length === 0) return "partial";
  if (ran.every((r) => r.status === "passed")) return "passed";
  if (ran.every((r) => r.status === "failed")) return "failed";
  return "partial";
}

export async function runHermesPostApplyQualityGates(input: {
  runId: string;
  gateIds: string[];
  operatorApproval: OperatorQualityGateApproval;
  timeoutMs?: number;
}): Promise<{
  runId: string;
  status: "quality_gates_completed";
  batchId: string;
  results: HermesQualityGateRunResultItem[];
  overallStatus: "passed" | "failed" | "partial";
  notSignOff: true;
  consoleUrl: string;
}> {
  const ctx = validateHermesQualityGatesForRun(input);
  const timeoutMs = input.timeoutMs ?? HERMES_QUALITY_GATE_DEFAULT_TIMEOUT_MS;
  const batchId = uuidv4();
  const scripts = readPackageScripts(ctx.repoPath);
  const gatesRoot = path.join(ctx.evidenceDirectory, "quality-gates");
  fs.mkdirSync(gatesRoot, { recursive: true });

  auditHermesQualityGatesRequested(
    ctx.runId,
    ctx.taskId,
    ctx.dispatch.id,
    { gateIds: ctx.gateIds, batchId },
    input.operatorApproval.approvedBy,
  );

  const results: HermesQualityGateRunResultItem[] = [];

  for (const gateId of ctx.gateIds) {
    const spec = execSpecForHermesQualityGateId(gateId);
    const command = commandForHermesQualityGateId(gateId);
    const gateDir = path.join(gatesRoot, gateId);
    fs.mkdirSync(gateDir, { recursive: true });

    const stdoutPath = path.join(gateDir, "stdout.log");
    const stderrPath = path.join(gateDir, "stderr.log");
    const resultPath = path.join(gateDir, "result.json");
    const startedAt = new Date().toISOString();

    if (!scriptExistsForGate(scripts, gateId)) {
      const finishedAt = new Date().toISOString();
      const skippedResult: HermesQualityGateRunResultItem = {
        gateId,
        command,
        status: "skipped",
        exitCode: 0,
        startedAt,
        finishedAt,
        artifactPath: resultPath,
        stdoutArtifactPath: stdoutPath,
        stderrArtifactPath: stderrPath,
        timedOut: false,
      };
      fs.writeFileSync(stdoutPath, "", "utf8");
      fs.writeFileSync(stderrPath, `Skipped: no npm script for gate "${gateId}"\n`, "utf8");
      fs.writeFileSync(
        resultPath,
        JSON.stringify(
          {
            schemaVersion: "hermes-quality-gate-result/v1",
            gateId,
            command,
            status: "skipped",
            exitCode: 0,
            repoPath: ctx.repoPath,
            cwd: ctx.repoPath,
            timedOut: false,
            durationMs: 0,
            startedAt,
            finishedAt,
            notSignOff: true,
          },
          null,
          2,
        ),
        "utf8",
      );
      insertHermesQualityGateRun({
        runId: ctx.runId,
        patchApplicationId: ctx.patchApplication.id,
        dispatchId: ctx.dispatch.id,
        batchId,
        gateId,
        command,
        status: "skipped",
        exitCode: 0,
        durationMs: 0,
        timedOut: false,
        resultArtifactPath: resultPath,
        stdoutArtifactPath: stdoutPath,
        stderrArtifactPath: stderrPath,
        operatorBy: input.operatorApproval.approvedBy,
        operatorReason: input.operatorApproval.reason,
        startedAt,
        finishedAt,
      });
      results.push(skippedResult);
      continue;
    }

    auditHermesQualityGateStarted(ctx.runId, ctx.taskId, ctx.dispatch.id, {
      gateId,
      command,
      batchId,
    });

    const execStarted = Date.now();
    const execResult = await runBoundedCommand({
      cwd: ctx.repoPath,
      executable: spec.executable,
      args: spec.args,
      timeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const status = execResult.exitCode === 0 && !execResult.timedOut ? "passed" : "failed";

    fs.writeFileSync(stdoutPath, execResult.stdout, "utf8");
    fs.writeFileSync(stderrPath, execResult.stderr, "utf8");
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        {
          schemaVersion: "hermes-quality-gate-result/v1",
          gateId,
          command,
          status,
          exitCode: execResult.exitCode,
          repoPath: ctx.repoPath,
          cwd: ctx.repoPath,
          timedOut: execResult.timedOut,
          durationMs: execResult.durationMs,
          startedAt,
          finishedAt,
          executable: spec.executable,
          args: spec.args,
          usesShell: false,
          notSignOff: true,
        },
        null,
        2,
      ),
      "utf8",
    );

    insertHermesQualityGateRun({
      runId: ctx.runId,
      patchApplicationId: ctx.patchApplication.id,
      dispatchId: ctx.dispatch.id,
      batchId,
      gateId,
      command,
      status,
      exitCode: execResult.exitCode,
      durationMs: execResult.durationMs,
      timedOut: execResult.timedOut,
      resultArtifactPath: resultPath,
      stdoutArtifactPath: stdoutPath,
      stderrArtifactPath: stderrPath,
      operatorBy: input.operatorApproval.approvedBy,
      operatorReason: input.operatorApproval.reason,
      startedAt,
      finishedAt,
    });

    const item: HermesQualityGateRunResultItem = {
      gateId,
      command,
      status,
      exitCode: execResult.exitCode,
      startedAt,
      finishedAt,
      artifactPath: resultPath,
      stdoutArtifactPath: stdoutPath,
      stderrArtifactPath: stderrPath,
      timedOut: execResult.timedOut,
    };
    results.push(item);

    const auditPayload = {
      gateId,
      command,
      batchId,
      exitCode: execResult.exitCode,
      timedOut: execResult.timedOut,
      artifactPath: resultPath,
    };
    if (status === "passed") {
      auditHermesQualityGatePassed(ctx.runId, ctx.taskId, ctx.dispatch.id, auditPayload);
    } else {
      auditHermesQualityGateFailed(ctx.runId, ctx.taskId, ctx.dispatch.id, auditPayload);
    }

    void execStarted;
  }

  const overallStatus = computeOverallStatus(results);
  const summaryPath = path.join(gatesRoot, `batch-${batchId}-summary.json`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        schemaVersion: "hermes-quality-gates-batch/v1",
        batchId,
        runId: ctx.runId,
        dispatchId: ctx.dispatch.id,
        overallStatus,
        results,
        completedAt: new Date().toISOString(),
        notSignOff: true,
      },
      null,
      2,
    ),
    "utf8",
  );

  auditHermesQualityGatesCompleted(
    ctx.runId,
    ctx.taskId,
    ctx.dispatch.id,
    { batchId, overallStatus, gateIds: ctx.gateIds, summaryPath },
    input.operatorApproval.approvedBy,
  );

  return {
    runId: ctx.runId,
    status: "quality_gates_completed",
    batchId,
    results,
    overallStatus,
    notSignOff: true,
    consoleUrl: `/engineer/runs/${ctx.runId}`,
  };
}
