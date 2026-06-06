import Link from "next/link";
import { notFound } from "next/navigation";
import { assessVeraExecutionReadiness, isVeraRunExecutionBlocked } from "@/lib/engineer-console/bridge/vera-execution-readiness";
import { assessVeraExecutionStartReadiness } from "@/lib/engineer-console/bridge/vera-execution-start-readiness";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
} from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "@/lib/engineer-console/repo-intelligence/task-repo-path";
import {
  getDraftValidationErrors,
  getLatestWorkerPlanDraftForRun,
} from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";
import { getWorkerPlanChangedFilesScope } from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { getChangedFiles, getDiffSummary } from "@/lib/engineer-console/workspace/git-workspace";
import type { ApprovalReport } from "@/lib/engineer-console/types";
import { buildRunWorkflowSummary } from "@/lib/engineer-console/run-ux/build-run-workflow-summary";
import { RunLivePanel } from "@/components/engineer-console/run-live-panel";
import {
  canShowVeraExecutionApprovalPanel,
  VeraExecutionApprovalPanel,
} from "@/components/engineer-console/vera-execution-approval-panel";
import {
  canShowVeraExecutionStartPanel,
  VeraExecutionStartPanel,
} from "@/components/engineer-console/vera-execution-start-panel";
import {
  canShowVeraImplementationArtifactPanel,
  VeraImplementationArtifactPanel,
} from "@/components/engineer-console/vera-implementation-artifact-panel";
import {
  canShowVeraImplementationArtifactReviewPanel,
  VeraImplementationArtifactReviewPanel,
} from "@/components/engineer-console/vera-implementation-artifact-review-panel";
import {
  canShowVeraImplementationPatchProposalPanel,
  VeraImplementationPatchProposalPanel,
} from "@/components/engineer-console/vera-implementation-patch-proposal-panel";
import {
  canShowVeraImplementationPatchProposalReviewPanel,
  VeraImplementationPatchProposalReviewPanel,
} from "@/components/engineer-console/vera-implementation-patch-proposal-review-panel";
import {
  canShowVeraImplementationPatchApplicationPanel,
  VeraImplementationPatchApplicationPanel,
} from "@/components/engineer-console/vera-implementation-patch-application-panel";
import {
  canShowVeraImplementationPatchContentDraftPanel,
  VeraImplementationPatchContentDraftPanel,
} from "@/components/engineer-console/vera-implementation-patch-content-draft-panel";
import {
  canShowVeraImplementationPatchContentDraftReviewPanel,
  VeraImplementationPatchContentDraftReviewPanel,
} from "@/components/engineer-console/vera-implementation-patch-content-draft-review-panel";
import { assessVeraArtifactReviewReadiness } from "@/lib/engineer-console/bridge/vera-artifact-review-readiness";
import { assessVeraPatchApplicationReadiness } from "@/lib/engineer-console/bridge/vera-patch-application-readiness";
import { assessVeraPatchContentDraftReadiness } from "@/lib/engineer-console/bridge/vera-patch-content-draft-readiness";
import { assessVeraPatchContentDraftReviewReadiness } from "@/lib/engineer-console/bridge/vera-patch-content-draft-review-readiness";
import { assessVeraPatchProposalApprovalReadiness } from "@/lib/engineer-console/bridge/vera-patch-proposal-approval-readiness";
import { assessVeraPatchProposalReadiness } from "@/lib/engineer-console/bridge/vera-patch-proposal-readiness";
import {
  readVeraImplementationArtifact,
  readVeraImplementationPatchApplicationReport,
  readVeraImplementationPatchContentDraft,
  readVeraImplementationPatchProposal,
} from "@/lib/engineer-console/worker/vera-implementation-artifact-storage";
import { parseVeraRunGovernanceNotes } from "@/lib/engineer-console/bridge/vera-handoff-task-types";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  ensureEngineerConsoleReady();
  const { id } = await params;
  const run = getRunById(id);
  if (!run) notFound();

  const task = getTaskById(run.taskId);
  if (!task) notFound();

  let changedFiles: string[] = [];
  let diffSummary = "";
  try {
    const repoPath = resolveTaskTargetRepoPath(task);
    const scope = getWorkerPlanChangedFilesScope(id);
    changedFiles = await getChangedFiles(repoPath, scope ?? {});
    diffSummary = await getDiffSummary(repoPath, { changedFiles });
  } catch {
    changedFiles = [];
    diffSummary = "";
  }

  const qualityGates = getQualityGateResultsForRun(id);
  const reportJson = getApprovalReportJson(id);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;
  const latestDraft = getLatestWorkerPlanDraftForRun(id);
  const uxSummary = buildRunWorkflowSummary({
    run,
    task,
    qualityGates,
    approvalReport,
    changedFiles,
  });
  const veraReadiness = assessVeraExecutionReadiness(id);
  const veraStartReadiness = assessVeraExecutionStartReadiness(id);
  const showVeraExecutionApprovalPanel = canShowVeraExecutionApprovalPanel(run);
  const showVeraExecutionStartPanel = canShowVeraExecutionStartPanel(run);
  const veraExecutionBlocked = isVeraRunExecutionBlocked(run);
  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraImplementationArtifact = readVeraImplementationArtifact(
    id,
    governanceNotes.veraImplementationArtifactPath,
  );
  const showVeraImplementationArtifactPanel = canShowVeraImplementationArtifactPanel(
    run,
    veraImplementationArtifact,
  );
  const veraArtifactReviewReadiness = assessVeraArtifactReviewReadiness(id);
  const showVeraImplementationArtifactReviewPanel =
    canShowVeraImplementationArtifactReviewPanel(run);
  const veraPatchProposalReadiness = assessVeraPatchProposalReadiness(id);
  const veraPatchProposal = readVeraImplementationPatchProposal(
    id,
    governanceNotes.veraImplementationPatchProposalPath,
  );
  const showVeraImplementationPatchProposalPanel =
    canShowVeraImplementationPatchProposalPanel(run);
  const veraPatchProposalApprovalReadiness = assessVeraPatchProposalApprovalReadiness(id);
  const showVeraImplementationPatchProposalReviewPanel =
    canShowVeraImplementationPatchProposalReviewPanel(run);
  const veraPatchApplicationReadiness = assessVeraPatchApplicationReadiness(id);
  const veraPatchApplicationReport = readVeraImplementationPatchApplicationReport(
    id,
    governanceNotes.veraImplementationPatchApplicationPath,
  );
  const showVeraImplementationPatchApplicationPanel =
    canShowVeraImplementationPatchApplicationPanel(run);
  const veraPatchContentDraftReadiness = assessVeraPatchContentDraftReadiness(id);
  const veraPatchContentDraft = readVeraImplementationPatchContentDraft(
    id,
    governanceNotes.veraImplementationPatchContentDraftPath,
  );
  const showVeraImplementationPatchContentDraftPanel =
    canShowVeraImplementationPatchContentDraftPanel(run);
  const veraPatchContentDraftReviewReadiness = assessVeraPatchContentDraftReviewReadiness(id);
  const showVeraImplementationPatchContentDraftReviewPanel =
    canShowVeraImplementationPatchContentDraftReviewPanel(run);

  return (
    <div>
      <Link
        href={`/engineer/tasks/${task.id}`}
        className="text-sm text-[var(--muted)] hover:text-white"
      >
        ← Task: {task.title}
      </Link>
      <h1 className="mt-4 mb-6 text-2xl font-semibold">Run {run.id.slice(0, 8)}…</h1>
      {showVeraExecutionApprovalPanel ? (
        <VeraExecutionApprovalPanel
          run={run}
          taskId={task.id}
          readiness={{
            safeToRequestExecutionApproval: veraReadiness.safeToRequestExecutionApproval,
            reasons: veraReadiness.reasons,
            checks: veraReadiness.checks,
            veraWorkOrderId: veraReadiness.veraWorkOrderId,
            repoPath: veraReadiness.repoPath,
          }}
        />
      ) : null}
      {showVeraExecutionStartPanel ? (
        <VeraExecutionStartPanel
          run={run}
          taskId={task.id}
          readiness={{
            safeToStartVeraExecution: veraStartReadiness.safeToStartVeraExecution,
            reasons: veraStartReadiness.reasons,
            checks: veraStartReadiness.checks,
            veraWorkOrderId: veraStartReadiness.veraWorkOrderId,
            repoPath: veraStartReadiness.repoPath,
          }}
        />
      ) : null}
      {showVeraImplementationArtifactPanel ? (
        <VeraImplementationArtifactPanel
          run={run}
          taskId={task.id}
          artifact={veraImplementationArtifact}
        />
      ) : null}
      {showVeraImplementationArtifactReviewPanel ? (
        <VeraImplementationArtifactReviewPanel
          run={run}
          taskId={task.id}
          artifact={veraImplementationArtifact}
          readiness={{
            safeToReviewArtifact: veraArtifactReviewReadiness.safeToReviewArtifact,
            reasons: veraArtifactReviewReadiness.reasons,
            checks: veraArtifactReviewReadiness.checks,
            veraWorkOrderId: veraArtifactReviewReadiness.veraWorkOrderId,
            artifactPath: veraArtifactReviewReadiness.artifactPath,
            artifactHash: veraArtifactReviewReadiness.artifactHash,
          }}
        />
      ) : null}
      {showVeraImplementationPatchProposalPanel ? (
        <VeraImplementationPatchProposalPanel
          run={run}
          taskId={task.id}
          proposal={veraPatchProposal}
          readiness={{
            safeToCreateProposal: veraPatchProposalReadiness.safeToCreateProposal,
            reasons: veraPatchProposalReadiness.reasons,
            checks: veraPatchProposalReadiness.checks,
            veraWorkOrderId: veraPatchProposalReadiness.veraWorkOrderId,
            sourceArtifactPath: veraPatchProposalReadiness.sourceArtifactPath,
            sourceArtifactHash: veraPatchProposalReadiness.sourceArtifactHash,
          }}
        />
      ) : null}
      {showVeraImplementationPatchProposalReviewPanel ? (
        <VeraImplementationPatchProposalReviewPanel
          run={run}
          taskId={task.id}
          proposal={veraPatchProposal}
          readiness={{
            safeToReviewPatchProposal:
              veraPatchProposalApprovalReadiness.safeToReviewPatchProposal,
            reasons: veraPatchProposalApprovalReadiness.reasons,
            checks: veraPatchProposalApprovalReadiness.checks,
            veraWorkOrderId: veraPatchProposalApprovalReadiness.veraWorkOrderId,
            proposalPath: veraPatchProposalApprovalReadiness.proposalPath,
            proposalHash: veraPatchProposalApprovalReadiness.proposalHash,
            proposalSummary: veraPatchProposalApprovalReadiness.proposalSummary,
          }}
        />
      ) : null}
      {showVeraImplementationPatchContentDraftPanel ? (
        <VeraImplementationPatchContentDraftPanel
          run={run}
          taskId={task.id}
          draft={veraPatchContentDraft}
          readiness={{
            safeToCreatePatchContentDraft:
              veraPatchContentDraftReadiness.safeToCreatePatchContentDraft,
            reasonCodes: veraPatchContentDraftReadiness.reasonCodes,
            reasons: veraPatchContentDraftReadiness.reasons,
            checks: veraPatchContentDraftReadiness.checks,
            veraWorkOrderId: veraPatchContentDraftReadiness.veraWorkOrderId,
            sourceProposalPath: veraPatchContentDraftReadiness.sourceProposalPath,
            sourceProposalHash: veraPatchContentDraftReadiness.sourceProposalHash,
            existingDraftPath: veraPatchContentDraftReadiness.existingDraftPath,
            existingDraftHash: veraPatchContentDraftReadiness.existingDraftHash,
            patchAlreadyApplied: veraPatchContentDraftReadiness.patchAlreadyApplied,
          }}
        />
      ) : null}
      {showVeraImplementationPatchContentDraftReviewPanel ? (
        <VeraImplementationPatchContentDraftReviewPanel
          run={run}
          taskId={task.id}
          draft={veraPatchContentDraft}
          readiness={{
            safeToReviewPatchContentDraft:
              veraPatchContentDraftReviewReadiness.safeToReviewPatchContentDraft,
            reasons: veraPatchContentDraftReviewReadiness.reasons,
            checks: veraPatchContentDraftReviewReadiness.checks,
            veraWorkOrderId: veraPatchContentDraftReviewReadiness.veraWorkOrderId,
            draftPath: veraPatchContentDraftReviewReadiness.draftPath,
            draftHash: veraPatchContentDraftReviewReadiness.draftHash,
            draftSummary: veraPatchContentDraftReviewReadiness.draftSummary,
          }}
        />
      ) : null}
      {showVeraImplementationPatchApplicationPanel ? (
        <VeraImplementationPatchApplicationPanel
          run={run}
          taskId={task.id}
          applicationReport={veraPatchApplicationReport}
          readiness={{
            safeToApplyPatch: veraPatchApplicationReadiness.safeToApplyPatch,
            reasonCodes: veraPatchApplicationReadiness.reasonCodes,
            reasons: veraPatchApplicationReadiness.reasons,
            checks: veraPatchApplicationReadiness.checks,
            veraWorkOrderId: veraPatchApplicationReadiness.veraWorkOrderId,
            proposalPath: veraPatchApplicationReadiness.proposalPath,
            proposalHash: veraPatchApplicationReadiness.proposalHash,
            worktreePath: veraPatchApplicationReadiness.worktreePath,
            applicablePatchCount: veraPatchApplicationReadiness.applicablePatchCount,
          }}
        />
      ) : null}
      <RunLivePanel
        runId={id}
        veraExecutionBlocked={veraExecutionBlocked}
        initial={{
          run,
          task,
          changedFiles,
          diffSummary,
          qualityGates,
          approvalReport,
          workerPlanDraft: latestDraft
            ? {
                id: latestDraft.id,
                runId: latestDraft.runId,
                provider: latestDraft.provider,
                model: latestDraft.model,
                validationStatus: latestDraft.validationStatus,
                parsedPlan: latestDraft.parsedPlanJson
                  ? JSON.parse(latestDraft.parsedPlanJson)
                  : null,
                rawResponse: latestDraft.rawResponse,
                validationErrors: getDraftValidationErrors(latestDraft),
                createdAt: latestDraft.createdAt,
              }
            : null,
          uxSummary,
        }}
      />
    </div>
  );
}
