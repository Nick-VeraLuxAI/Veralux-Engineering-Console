import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { parseEvidenceBundleJson } from "../evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../decision-records/decision-record-manager";
import { getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import type { RedactedReplayPackage } from "./replay-verification-types";
import type { ReplayVerificationResult } from "./replay-verification-types";
import { listDeploymentExecutionsForRun } from "../../release/deployment-execution/deployment-execution-manager";
import { listDeploymentHealthChecksForRun } from "../../release/deployment-health-check/deployment-health-check-manager";
import {
  getLatestDeploymentHealthPolicyResult,
  parseDeploymentHealthPolicyEvaluation,
} from "../../release/deployment-health-policy/deployment-health-policy-manager";
import { summarizeReleaseChecklistForRun } from "../../release/release-checklist/release-checklist-manager";
import { summarizeReleaseSignoffForRun } from "../../release/release-signoff/release-signoff-manager";
import { verifyRunReplay } from "./verify-run-replay";

const SENSITIVE_PATTERN =
  /^(prompt|rawResponse|raw_response|stdout|stderr|secret|token|api_key|password|authorization)$/i;

function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > 500) {
      return `${value.slice(0, 500)}…[truncated]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactObject(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PATTERN.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactObject(val, depth + 1);
    }
  }
  return out;
}

export function buildRedactedReplayPackage(
  runId: string,
  verification?: ReplayVerificationResult,
): RedactedReplayPackage {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found for run: ${runId}`);
  }

  const verificationResult = verification ?? verifyRunReplay(runId);
  const evidence = getEvidenceBundleForRun(runId);
  const bundleParsed = evidence ? parseEvidenceBundleJson(evidence.bundleJson) : null;
  const auditEvents = listAuditEventsForRun(runId);
  const decisions = listDecisionRecords(runId);
  const gates = getQualityGateResultsForRun(runId);

  return {
    packageVersion: "engineer_replay_package_v1",
    runId,
    builtAt: new Date().toISOString(),
    runSummary: {
      status: run.status,
      currentStep: run.currentStep,
      branchName: run.branchName,
      riskLevel: run.riskLevel,
    },
    taskSummary: {
      id: task.id,
      title: task.title,
    },
    repoRef: {
      registeredRepoId: task.registeredRepoId,
      repoName: bundleParsed?.repoName ?? null,
      repoPathRef: bundleParsed?.repoPathRef ?? null,
    },
    evidenceBundle: {
      id: evidence?.id ?? null,
      bundleHashPrefix: evidence?.bundleHash.slice(0, 16) ?? null,
      redactionVersion: evidence?.redactionVersion ?? null,
      updatedAt: evidence?.updatedAt ?? null,
    },
    auditEventHashes: auditEvents.map((e) => e.chainHash),
    decisionRecords: decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      evidenceBundleHashPrefix: d.evidenceBundleHash?.slice(0, 16) ?? null,
      auditChainHashPrefix: d.auditChainHash?.slice(0, 16) ?? null,
      createdAt: d.createdAt,
    })),
    qualityGateSummaries: gates.map((g) => ({
      command: g.command,
      status: g.status,
      exitCode: g.exitCode,
    })),
    governanceSummary: bundleParsed?.governance
      ? {
          riskLevel: bundleParsed.governance.riskLevel,
          canApprove: bundleParsed.governance.canApprove,
        }
      : null,
    deploymentExecutions: listDeploymentExecutionsForRun(runId).map((e) => ({
      id: e.id,
      status: e.status,
      profile: e.deploymentProfile,
      exitCode: e.exitCode,
      outputHashPrefix: e.outputHash?.slice(0, 12) ?? null,
      createdAt: e.createdAt,
    })),
    deploymentHealthChecks: listDeploymentHealthChecksForRun(runId).map((c) => ({
      id: c.id,
      status: c.status,
      profile: c.healthProfile,
      responseStatus: c.responseStatus,
      responseTimeMs: c.responseTimeMs,
      createdAt: c.createdAt,
    })),
    deploymentHealthPolicy: (() => {
      const latest = getLatestDeploymentHealthPolicyResult(runId);
      if (!latest) return null;
      const evaluation = parseDeploymentHealthPolicyEvaluation(latest);
      return {
        latestStatus: latest.status,
        latestEnvironmentName: evaluation.environmentName,
        policyVersion: latest.policyVersion,
        policyHashPrefix: latest.policyHash.slice(0, 12),
        evaluatedAt: evaluation.evaluatedAt,
      };
    })(),
    releaseChecklist: (() => {
      const summary = summarizeReleaseChecklistForRun(runId);
      if (summary.evaluationCount === 0 && summary.latestStatus === "not_started") {
        return null;
      }
      return {
        latestStatus: summary.latestStatus,
        blockerCount: summary.blockerCount,
        needsAttentionCount: summary.needsAttentionCount,
        latestRecommendedAction: summary.latestRecommendedAction,
      };
    })(),
    releaseSignoff: (() => {
      const summary = summarizeReleaseSignoffForRun(runId);
      if (summary.signoffCount === 0) return null;
      return {
        signoffCount: summary.signoffCount,
        latestDecision: summary.latestDecision,
        latestChecklistStatus: summary.latestChecklistStatus,
        latestCreatedAt: summary.latestCreatedAt,
      };
    })(),
    verification: redactObject(verificationResult) as ReplayVerificationResult,
  };
}
