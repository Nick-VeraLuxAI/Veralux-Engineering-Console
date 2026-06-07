import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VeraImplementationWorkerArtifact } from "./vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_ARTIFACT_FILENAME } from "./vera-implementation-artifact-types";
import type { VeraImplementationPatchProposal } from "./vera-implementation-patch-proposal-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_FILENAME } from "./vera-implementation-patch-proposal-types";
import type { VeraImplementationPatchApplicationReport } from "./vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_APPLICATION_FILENAME } from "./vera-implementation-patch-application-types";
import type { VeraImplementationPatchContentDraft } from "./vera-implementation-patch-content-draft-types";
import { VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_FILENAME } from "./vera-implementation-patch-content-draft-types";
import type { VeraPostPatchQualityReport } from "./vera-post-patch-quality-report-types";
import { VERA_POST_PATCH_QUALITY_REPORT_FILENAME } from "./vera-post-patch-quality-report-types";

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

export function resolveVeraImplementationPatchApplicationPath(runId: string): string {
  return path.join(
    resolveRunArtifactRoot(),
    runId.trim(),
    VERA_IMPLEMENTATION_PATCH_APPLICATION_FILENAME,
  );
}

export function writeVeraImplementationPatchApplicationReport(
  report: VeraImplementationPatchApplicationReport,
): { applicationReportPath: string; applicationReportHash: string } {
  const applicationReportPath = resolveVeraImplementationPatchApplicationPath(report.runId);
  fs.mkdirSync(path.dirname(applicationReportPath), { recursive: true });
  const content = JSON.stringify(report, null, 2);
  fs.writeFileSync(applicationReportPath, content, "utf8");
  return {
    applicationReportPath,
    applicationReportHash: hashArtifactContent(content),
  };
}

export function readVeraImplementationPatchApplicationReport(
  runId: string,
  reportPathOverride?: string | null,
): VeraImplementationPatchApplicationReport | null {
  const reportPath =
    reportPathOverride?.trim() || resolveVeraImplementationPatchApplicationPath(runId);
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(reportPath, "utf8"),
    ) as VeraImplementationPatchApplicationReport;
  } catch {
    return null;
  }
}

export function resolveVeraImplementationPatchContentDraftPath(runId: string): string {
  return path.join(
    resolveRunArtifactRoot(),
    runId.trim(),
    VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_FILENAME,
  );
}

export function writeVeraImplementationPatchContentDraft(
  draft: VeraImplementationPatchContentDraft,
): { draftPath: string; draftHash: string } {
  const draftPath = resolveVeraImplementationPatchContentDraftPath(draft.runId);
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  const content = JSON.stringify(draft, null, 2);
  fs.writeFileSync(draftPath, content, "utf8");
  return {
    draftPath,
    draftHash: hashArtifactContent(content),
  };
}

export function readVeraImplementationPatchContentDraft(
  runId: string,
  draftPathOverride?: string | null,
): VeraImplementationPatchContentDraft | null {
  const draftPath =
    draftPathOverride?.trim() || resolveVeraImplementationPatchContentDraftPath(runId);
  if (!fs.existsSync(draftPath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(draftPath, "utf8"),
    ) as VeraImplementationPatchContentDraft;
  } catch {
    return null;
  }
}

export function resolveVeraPostPatchQualityReportPath(runId: string): string {
  return path.join(
    resolveRunArtifactRoot(),
    runId.trim(),
    VERA_POST_PATCH_QUALITY_REPORT_FILENAME,
  );
}

export function writeVeraPostPatchQualityReport(
  report: VeraPostPatchQualityReport,
): { qualityReportPath: string; qualityReportHash: string } {
  const qualityReportPath = resolveVeraPostPatchQualityReportPath(report.runId);
  fs.mkdirSync(path.dirname(qualityReportPath), { recursive: true });
  const content = JSON.stringify(report, null, 2);
  fs.writeFileSync(qualityReportPath, content, "utf8");
  return {
    qualityReportPath,
    qualityReportHash: hashArtifactContent(content),
  };
}

export function readVeraPostPatchQualityReport(
  runId: string,
  reportPathOverride?: string | null,
): VeraPostPatchQualityReport | null {
  const reportPath =
    reportPathOverride?.trim() || resolveVeraPostPatchQualityReportPath(runId);
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(reportPath, "utf8"),
    ) as VeraPostPatchQualityReport;
  } catch {
    return null;
  }
}
