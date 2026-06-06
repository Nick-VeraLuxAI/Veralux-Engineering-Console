import fs from "node:fs";
import path from "node:path";
import { analyzeVeraHandoffTask } from "../bridge/vera-handoff-task";
import {
  extractVeraWorkOrderIdFromDescription,
  parseVeraRunGovernanceNotes,
} from "../bridge/vera-handoff-task-types";
import { getPublicModelProviderInfo } from "../model-router/model-provider-config";
import type { EngineeringTask } from "../types";
import type {
  VeraImplementationWorkerArtifact,
  VeraImplementationWorkerMode,
  VeraImplementationWorkerResult,
  VeraImplementationWorkerStatus,
} from "./vera-implementation-artifact-types";
import { writeVeraImplementationArtifact } from "./vera-implementation-artifact-storage";

const INSTRUCTIONS_EXCERPT_LIMIT = 600;

export type VeraImplementationWorkerInput = {
  runId: string;
  task: EngineeringTask;
  veraWorkOrderId?: string | null;
  repoPath: string;
  branchName: string;
  governanceNotes?: string | null;
};

function excerptInstructions(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length <= INSTRUCTIONS_EXCERPT_LIMIT) return trimmed;
  return `${trimmed.slice(0, INSTRUCTIONS_EXCERPT_LIMIT)}…`;
}

function extractInstructionsSection(description: string): string {
  const match = description.match(/### Instructions\s*([\s\S]*?)(?:\n### |\s*$)/);
  return match?.[1]?.trim() ?? description.trim();
}

function resolveWorkerMode(): VeraImplementationWorkerMode {
  const provider = getPublicModelProviderInfo();
  if (provider.provider === "mock" || provider.providerStatus === "misconfigured") {
    return "deterministic_metadata";
  }
  return "model_ready_deferred";
}

function buildDeterministicSummary(input: VeraImplementationWorkerInput): {
  implementationSummary: string;
  interpretedObjective: string;
  proposedNextActions: string[];
  warnings: string[];
  filesInspected: string[];
  filesProposed: string[];
} {
  const instructions = extractInstructionsSection(input.task.description);
  const interpretedObjective =
    instructions.split("\n").find((line) => line.trim().length > 0)?.trim() ??
    input.task.title;

  return {
    implementationSummary:
      "Deterministic Vera implementation artifact created from governed task metadata. No repository source files were modified.",
    interpretedObjective,
    proposedNextActions: [
      "Review the implementation artifact and interpreted objective.",
      "Complete engineering review signoff before any commit or PR action.",
      "Use separate governed gates for PR, merge, deploy, and release.",
    ],
    warnings: [
      "This phase does not apply patches, create commits, or open pull requests.",
      "Model-backed implementation remains deferred until a governed provider path is enabled.",
    ],
    filesInspected: [],
    filesProposed: [],
  };
}

function buildArtifact(
  input: VeraImplementationWorkerInput,
  detail: {
    workerMode: VeraImplementationWorkerMode;
    workerStatus: VeraImplementationWorkerStatus;
    blockers: string[];
    warnings: string[];
    implementationSummary: string;
    interpretedObjective: string;
    proposedNextActions: string[];
    filesInspected: string[];
    filesChanged: string[];
    filesProposed: string[];
    patchProposalPath: string | null;
    evidencePath: string | null;
    repoPath: string | null;
  },
): VeraImplementationWorkerArtifact {
  const governance = parseVeraRunGovernanceNotes(input.governanceNotes);
  const veraWorkOrderId =
    input.veraWorkOrderId ??
    governance.veraWorkOrderId ??
    extractVeraWorkOrderIdFromDescription(input.task.description);

  return {
    runId: input.runId,
    taskId: input.task.id,
    veraWorkOrderId,
    createdAt: new Date().toISOString(),
    workerMode: detail.workerMode,
    workerStatus: detail.workerStatus,
    branchName: input.branchName,
    repoPath: detail.repoPath,
    worktreePath: detail.repoPath,
    taskTitle: input.task.title,
    taskInstructionsExcerpt: excerptInstructions(input.task.description),
    implementationSummary: detail.implementationSummary,
    interpretedObjective: detail.interpretedObjective,
    proposedNextActions: detail.proposedNextActions,
    blockers: detail.blockers,
    warnings: detail.warnings,
    filesInspected: detail.filesInspected,
    filesChanged: detail.filesChanged,
    filesProposed: detail.filesProposed,
    patchProposalPath: detail.patchProposalPath,
    evidencePath: detail.evidencePath,
    noPrCreated: true,
    noMergePerformed: true,
    noDeploymentPerformed: true,
    noReleasePerformed: true,
  };
}

export function runVeraImplementationWorker(
  input: VeraImplementationWorkerInput,
): VeraImplementationWorkerResult {
  const taskAnalysis = analyzeVeraHandoffTask(input.task);

  const workerMode = resolveWorkerMode();
  const repoExists = Boolean(input.repoPath?.trim()) && fs.existsSync(input.repoPath);
  const blockers: string[] = [];

  if (!taskAnalysis.isVeraLuxOsHandoffTask) {
    blockers.push("Task is not a VeraLux OS handoff.");
  }
  if (!repoExists) {
    blockers.push("Repository path is missing or unavailable for implementation worker.");
  }

  const deterministic = buildDeterministicSummary(input);
  const workerStatus: VeraImplementationWorkerStatus =
    blockers.length > 0 ? "blocked" : "artifact_created";

  const artifact = buildArtifact(input, {
    workerMode,
    workerStatus,
    blockers,
    warnings: deterministic.warnings,
    implementationSummary:
      workerStatus === "blocked"
        ? "Vera implementation worker produced a reviewable blocked artifact."
        : deterministic.implementationSummary,
    interpretedObjective: deterministic.interpretedObjective,
    proposedNextActions: deterministic.proposedNextActions,
    filesInspected: deterministic.filesInspected,
    filesChanged: [],
    filesProposed: deterministic.filesProposed,
    patchProposalPath: null,
    evidencePath: null,
    repoPath: repoExists ? path.resolve(input.repoPath) : null,
  });

  try {
    const { artifactPath, artifactHash } = writeVeraImplementationArtifact(artifact);
    return {
      status: workerStatus,
      workerMode,
      artifactPath,
      artifactHash,
      artifact,
      message: artifact.implementationSummary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      workerMode,
      artifactPath: null,
      artifactHash: null,
      artifact: null,
      message,
    };
  }
}
