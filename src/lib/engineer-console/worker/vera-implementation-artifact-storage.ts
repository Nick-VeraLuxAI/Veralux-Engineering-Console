import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VeraImplementationWorkerArtifact } from "./vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_ARTIFACT_FILENAME } from "./vera-implementation-artifact-types";
import type { VeraImplementationPatchProposal } from "./vera-implementation-patch-proposal-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_FILENAME } from "./vera-implementation-patch-proposal-types";

export function resolveRunArtifactRoot(): string {
  const dbPath =
    process.env.ENGINEER_CONSOLE_DB_PATH?.trim() ||
    path.join(process.cwd(), "data", "engineer-console.db");
  return path.join(path.dirname(path.resolve(dbPath)), "run-artifacts");
}

export function resolveVeraImplementationArtifactPath(runId: string): string {
  return path.join(
    resolveRunArtifactRoot(),
    runId.trim(),
    VERA_IMPLEMENTATION_ARTIFACT_FILENAME,
  );
}

export function hashArtifactContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function writeVeraImplementationArtifact(
  artifact: VeraImplementationWorkerArtifact,
): { artifactPath: string; artifactHash: string } {
  const artifactPath = resolveVeraImplementationArtifactPath(artifact.runId);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const content = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(artifactPath, content, "utf8");
  return {
    artifactPath,
    artifactHash: hashArtifactContent(content),
  };
}

export function resolveVeraImplementationPatchProposalPath(runId: string): string {
  return path.join(
    resolveRunArtifactRoot(),
    runId.trim(),
    VERA_IMPLEMENTATION_PATCH_PROPOSAL_FILENAME,
  );
}

export function readVeraImplementationArtifactAtPath(
  artifactPath: string,
): VeraImplementationWorkerArtifact | null {
  if (!artifactPath?.trim() || !fs.existsSync(artifactPath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(artifactPath, "utf8"),
    ) as VeraImplementationWorkerArtifact;
  } catch {
    return null;
  }
}

export function readVeraImplementationArtifact(
  runId: string,
  artifactPathOverride?: string | null,
): VeraImplementationWorkerArtifact | null {
  const override = artifactPathOverride?.trim();
  if (override) {
    return readVeraImplementationArtifactAtPath(override);
  }
  return readVeraImplementationArtifactAtPath(resolveVeraImplementationArtifactPath(runId));
}

export function writeVeraImplementationPatchProposal(
  proposal: VeraImplementationPatchProposal,
): { proposalPath: string; proposalHash: string } {
  const proposalPath = resolveVeraImplementationPatchProposalPath(proposal.runId);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  const content = JSON.stringify(proposal, null, 2);
  fs.writeFileSync(proposalPath, content, "utf8");
  return {
    proposalPath,
    proposalHash: hashArtifactContent(content),
  };
}

export function readVeraImplementationPatchProposal(
  runId: string,
  proposalPathOverride?: string | null,
): VeraImplementationPatchProposal | null {
  const proposalPath =
    proposalPathOverride?.trim() || resolveVeraImplementationPatchProposalPath(runId);
  if (!fs.existsSync(proposalPath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(proposalPath, "utf8"),
    ) as VeraImplementationPatchProposal;
  } catch {
    return null;
  }
}
