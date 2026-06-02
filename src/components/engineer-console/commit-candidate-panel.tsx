"use client";

import React, { useCallback, useEffect, useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import type { HermesWorkerEvidenceSummary } from "@/lib/engineer-console/hermes-worker/hermes-evidence-types";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";

interface CommitCandidatePublic {
  id: string;
  status?: string;
  branchName: string;
  commitMessage: string;
  changedFiles: string[];
  commitPacketPath: string;
  prDraftPath: string;
  evidenceSnapshotHash: string;
  createdBy: string;
  createdAt: string;
  notCommitted?: boolean;
  localCommitHash?: string | null;
  localCommitEvidencePath?: string | null;
  notPushed?: boolean;
  remoteRef?: string | null;
  remoteBranchName?: string | null;
  remotePushEvidencePath?: string | null;
  prStatus?: string | null;
  prUrl?: string | null;
  prNumber?: string | null;
  prEvidencePath?: string | null;
  prBaseBranch?: string | null;
  prHeadBranch?: string | null;
  mergeReadinessStatus?: string | null;
  mergeReadinessDecision?: string | null;
  mergeReadinessReviewedAt?: string | null;
  mergeReadinessReviewedBy?: string | null;
  mergeReadinessEvidencePath?: string | null;
  mergeStatus?: string | null;
  mergeMethod?: string | null;
  mergeCommitSha?: string | null;
  mergedAt?: string | null;
  mergeEvidencePath?: string | null;
  deployReadinessStatus?: string | null;
  deployReadinessDecision?: string | null;
  deployReadinessReviewedAt?: string | null;
  deployReadinessReviewedBy?: string | null;
  deployReadinessEvidencePath?: string | null;
  deploymentPacketStatus?: string | null;
  deploymentTargetEnvironment?: string | null;
  deploymentPacketPath?: string | null;
  deploymentPlanPath?: string | null;
  deploymentPacketCreatedAt?: string | null;
  deploymentPacketCreatedBy?: string | null;
  stagingDeploymentStatus?: string | null;
  stagingDeploymentAdapter?: string | null;
  stagingDeploymentStartedAt?: string | null;
  stagingDeploymentFinishedAt?: string | null;
  stagingDeploymentExitCode?: number | null;
  stagingDeploymentEvidencePath?: string | null;
  stagingDeployedBy?: string | null;
  productionReadinessStatus?: string | null;
  productionReadinessDecision?: string | null;
  productionReadinessReviewedAt?: string | null;
  productionReadinessReviewedBy?: string | null;
  productionReadinessEvidencePath?: string | null;
  notMerged?: boolean;
}

interface ReviewSignoffLatest {
  decision: string;
  reviewer: string;
  createdAt: string;
}

export function CommitCandidatePanel({ runId }: { runId: string }) {
  const [evidence, setEvidence] = useState<{
    patchApplication: HermesWorkerEvidenceSummary["patchApplication"];
    postApplyQualityGates: HermesWorkerEvidenceSummary["postApplyQualityGates"];
  } | null>(null);
  const [signoff, setSignoff] = useState<ReviewSignoffLatest | null>(null);
  const [latest, setLatest] = useState<CommitCandidatePublic | null>(null);
  const [history, setHistory] = useState<CommitCandidatePublic[]>([]);
  const [prPreview, setPrPreview] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [prepareReason, setPrepareReason] = useState("");
  const [qualityGateOverride, setQualityGateOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localCommitReason, setLocalCommitReason] = useState("");
  const [localCommitResult, setLocalCommitResult] = useState<{
    commitHash: string;
    commitEvidencePath: string;
    branchName: string;
  } | null>(null);
  const [pushReason, setPushReason] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [pushResult, setPushResult] = useState<{
    remoteRef: string;
    pushEvidencePath: string;
    branchName: string;
  } | null>(null);
  const [githubPrAvailable, setGithubPrAvailable] = useState(true);
  const [baseBranch, setBaseBranch] = useState("main");
  const [prReason, setPrReason] = useState("");
  const [prResult, setPrResult] = useState<{
    pullRequestUrl: string | null;
    pullRequestNumber: number | null;
    prEvidencePath: string;
    status: string;
  } | null>(null);
  const [mergeReadinessDecision, setMergeReadinessDecision] = useState<
    "ready" | "not_ready" | "blocked"
  >("ready");
  const [mergeReadinessReason, setMergeReadinessReason] = useState("");
  const [mergeReadinessNotes, setMergeReadinessNotes] = useState("");
  const [mergeReadinessResult, setMergeReadinessResult] = useState<{
    decision: string;
    mergeReadinessPath: string;
  } | null>(null);
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge" | "rebase">("squash");
  const [mergeReason, setMergeReason] = useState("");
  const [mergeResult, setMergeResult] = useState<{
    mergeCommitSha: string | null;
    mergeEvidencePath: string;
    pullRequestUrl: string;
  } | null>(null);
  const [deployReadinessDecision, setDeployReadinessDecision] = useState<
    "ready" | "not_ready" | "blocked"
  >("ready");
  const [deployReadinessReason, setDeployReadinessReason] = useState("");
  const [deployReadinessNotes, setDeployReadinessNotes] = useState("");
  const [deployReadinessResult, setDeployReadinessResult] = useState<{
    decision: string;
    deployReadinessPath: string;
  } | null>(null);
  const [deploymentTargetEnvironment, setDeploymentTargetEnvironment] = useState("staging");
  const [deploymentPacketReason, setDeploymentPacketReason] = useState("");
  const [deploymentNotes, setDeploymentNotes] = useState("");
  const [deploymentPacketResult, setDeploymentPacketResult] = useState<{
    targetEnvironment: string;
    deploymentPacketPath: string;
    deploymentPlanPath: string;
  } | null>(null);
  const [stagingDeployAdapterAvailable, setStagingDeployAdapterAvailable] = useState(false);
  const [stagingDeployReason, setStagingDeployReason] = useState("");
  const [stagingDeployResult, setStagingDeployResult] = useState<{
    status: string;
    exitCode: number;
    deploymentEvidencePath: string;
  } | null>(null);
  const [productionReadinessDecision, setProductionReadinessDecision] = useState<
    "ready" | "not_ready" | "blocked"
  >("ready");
  const [productionReadinessReason, setProductionReadinessReason] = useState("");
  const [productionVerificationNotes, setProductionVerificationNotes] = useState("");
  const [productionReadinessResult, setProductionReadinessResult] = useState<{
    decision: string;
    productionReadinessEvidencePath: string;
  } | null>(null);

  const load = useCallback(async () => {
    const [evidenceRes, signoffRes, candidateRes] = await Promise.all([
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/hermes-worker/evidence`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-signoff`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/commit-candidate`),
    ]);

    if (evidenceRes.ok) {
      const body = (await evidenceRes.json()) as { summary: HermesWorkerEvidenceSummary };
      setEvidence({
        patchApplication: body.summary.patchApplication,
        postApplyQualityGates: body.summary.postApplyQualityGates,
      });
    }

    if (signoffRes.ok) {
      const body = (await signoffRes.json()) as { latest: ReviewSignoffLatest | null };
      setSignoff(body.latest);
    }

    if (candidateRes.ok) {
      const body = (await candidateRes.json()) as {
        latest: CommitCandidatePublic | null;
        history: CommitCandidatePublic[];
        githubPrCreationAvailable?: boolean;
        stagingDeployAdapterAvailable?: boolean;
      };
      setGithubPrAvailable(body.githubPrCreationAvailable !== false);
      setStagingDeployAdapterAvailable(body.stagingDeployAdapterAvailable === true);
      setLatest(body.latest);
      setHistory(body.history);
      if (body.latest?.prDraftPath) {
        setPrPreview(null);
      }
    }
  }, [runId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load commit candidate context");
    });
  }, [load]);

  async function loadPrPreview(path: string) {
    try {
      const res = await fetch(`/api/engineer-console/runs/${runId}/commit-candidate`);
      void res;
      setPrPreview(`See artifact on Console host:\n${path}`);
    } catch {
      setPrPreview(null);
    }
  }

  const canPrepare =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied";

  const canLocalCommit =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "commit_candidate_prepared" || latest.status === "prepared") &&
    latest.notCommitted !== false &&
    !latest.localCommitHash;

  async function handleLocalCommit() {
    const reason = localCommitReason.trim();
    if (!reason) {
      setError("Local commit approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate to commit.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/commit-local`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        commitHash?: string;
        commitEvidencePath?: string;
        branchName?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setLocalCommitResult({
        commitHash: body.commitHash ?? "",
        commitEvidencePath: body.commitEvidencePath ?? "",
        branchName: body.branchName ?? "",
      });
      setMessage("Local git commit created. Not pushed. Not merged. Not deployed.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Local commit failed");
    } finally {
      setBusy(false);
    }
  }

  const canPushRemote =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest?.status === "local_commit_created" &&
    Boolean(latest.localCommitHash) &&
    latest.notPushed !== false;

  const canCreatePr =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest?.status === "remote_branch_pushed" &&
    Boolean(latest.remoteRef) &&
    !latest.prUrl &&
    latest.prStatus !== "pull_request_created" &&
    latest.prStatus !== "pull_request_packet_prepared";

  const canRecordMergeReadiness =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "pull_request_created" ||
      latest.status === "pull_request_packet_prepared" ||
      latest.status === "merge_readiness_recorded") &&
    Boolean(latest.prEvidencePath) &&
    Boolean(latest.localCommitHash) &&
    Boolean(latest.remotePushEvidencePath);

  const canMergePr =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    githubPrAvailable &&
    latest?.status === "merge_readiness_recorded" &&
    latest.mergeReadinessDecision === "ready" &&
    Boolean(latest.prUrl) &&
    Boolean(latest.prNumber) &&
    latest.mergeStatus !== "pull_request_merged";

  const canRecordDeployReadiness =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "pull_request_merged" ||
      latest.status === "deploy_readiness_recorded" ||
      latest.mergeStatus === "pull_request_merged") &&
    Boolean(latest.mergeEvidencePath) &&
    Boolean(latest.mergeCommitSha || latest.mergeStatus === "pull_request_merged");

  const canPrepareDeploymentPacket =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "deploy_readiness_recorded" ||
      latest.status === "deployment_packet_prepared" ||
      latest.deployReadinessStatus === "deploy_readiness_recorded") &&
    latest.deployReadinessDecision === "ready" &&
    Boolean(latest.mergeEvidencePath) &&
    (latest.mergeStatus === "pull_request_merged" ||
      latest.status === "pull_request_merged" ||
      latest.status === "deploy_readiness_recorded" ||
      latest.status === "deployment_packet_prepared");

  const canDeployToStaging =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "deployment_packet_prepared" ||
      latest.deploymentPacketStatus === "deployment_packet_prepared" ||
      latest.status === "staging_deployment_failed") &&
    latest.deploymentTargetEnvironment === "staging" &&
    Boolean(latest.deploymentPacketPath) &&
    stagingDeployAdapterAvailable;

  const canRecordProductionReadiness =
    signoff?.decision === "approved" &&
    evidence?.patchApplication?.status === "patch_applied" &&
    latest &&
    (latest.status === "staging_deployed" ||
      latest.stagingDeploymentStatus === "staging_deployed" ||
      latest.status === "production_readiness_recorded") &&
    latest.stagingDeploymentStatus !== "staging_deployment_failed" &&
    Boolean(latest.stagingDeploymentEvidencePath) &&
    Boolean(latest.deploymentPacketPath);

  async function handleRecordProductionReadiness() {
    const reason = productionReadinessReason.trim();
    if (!reason) {
      setError("Production readiness approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for production readiness review.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/production-readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            decision: productionReadinessDecision,
            verificationNotes: productionVerificationNotes.trim() || undefined,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        decision?: string;
        productionReadinessEvidencePath?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setProductionReadinessResult({
        decision: body.decision ?? productionReadinessDecision,
        productionReadinessEvidencePath: body.productionReadinessEvidencePath ?? "",
      });
      setMessage(
        "Production readiness recorded. This does not deploy to production or mark the run complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Production readiness recording failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeployToStaging() {
    const reason = stagingDeployReason.trim();
    if (!reason) {
      setError("Staging deployment approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for staging deployment.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/staging-deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            targetEnvironment: "staging",
            deploymentAdapter: "local-script",
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        status?: string;
        exitCode?: number;
        deploymentEvidencePath?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStagingDeployResult({
        status: body.status ?? "staging_deployed",
        exitCode: body.exitCode ?? 0,
        deploymentEvidencePath: body.deploymentEvidencePath ?? "",
      });
      setMessage(
        body.status === "staging_deployed"
          ? "Staging deployment completed. This does not deploy to production or mark the run complete."
          : "Staging deployment failed. Evidence was recorded. Run is not marked complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Staging deployment failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePrepareDeploymentPacket() {
    const reason = deploymentPacketReason.trim();
    if (!reason) {
      setError("Deployment packet approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for deployment packet.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/deployment-packet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            targetEnvironment: deploymentTargetEnvironment,
            deploymentNotes: deploymentNotes.trim() || undefined,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        targetEnvironment?: string;
        deploymentPacketPath?: string;
        deploymentPlanPath?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDeploymentPacketResult({
        targetEnvironment: body.targetEnvironment ?? deploymentTargetEnvironment,
        deploymentPacketPath: body.deploymentPacketPath ?? "",
        deploymentPlanPath: body.deploymentPlanPath ?? "",
      });
      setMessage(
        "Deployment packet prepared. This does not deploy or mark the run complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deployment packet preparation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordDeployReadiness() {
    const reason = deployReadinessReason.trim();
    if (!reason) {
      setError("Deploy readiness approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for deploy readiness review.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/deploy-readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            decision: deployReadinessDecision,
            notes: deployReadinessNotes.trim() || undefined,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        decision?: string;
        deployReadinessPath?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDeployReadinessResult({
        decision: body.decision ?? deployReadinessDecision,
        deployReadinessPath: body.deployReadinessPath ?? "",
      });
      setMessage(
        "Deploy readiness recorded. This does not deploy or mark the run complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deploy readiness recording failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMergePr() {
    const reason = mergeReason.trim();
    if (!reason) {
      setError("Merge approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for governed merge.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/merge-pr`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            mergeMethod,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        mergeCommitSha?: string | null;
        mergeEvidencePath?: string;
        pullRequestUrl?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMergeResult({
        mergeCommitSha: body.mergeCommitSha ?? null,
        mergeEvidencePath: body.mergeEvidencePath ?? "",
        pullRequestUrl: body.pullRequestUrl ?? latest.prUrl ?? "",
      });
      setMessage(
        "Governed pull request merged. This does not deploy or mark the run complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Governed PR merge failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordMergeReadiness() {
    const reason = mergeReadinessReason.trim();
    if (!reason) {
      setError("Merge readiness approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for merge readiness review.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/merge-readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            decision: mergeReadinessDecision,
            notes: mergeReadinessNotes.trim() || undefined,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        decision?: string;
        mergeReadinessPath?: string;
        notMerged?: boolean;
        notDeployed?: boolean;
        notComplete?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMergeReadinessResult({
        decision: body.decision ?? mergeReadinessDecision,
        mergeReadinessPath: body.mergeReadinessPath ?? "",
      });
      setMessage(
        "Merge readiness recorded. This does not merge, deploy, or mark the run complete.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Merge readiness recording failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePr(mode: "create_pr" | "prepare_packet") {
    const reason = prReason.trim();
    if (!reason) {
      setError("PR creation approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate for PR creation.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/create-pr`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            baseBranch: baseBranch.trim() || "main",
            mode,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        status?: string;
        pullRequestUrl?: string | null;
        pullRequestNumber?: number | null;
        prEvidencePath?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPrResult({
        pullRequestUrl: body.pullRequestUrl ?? null,
        pullRequestNumber: body.pullRequestNumber ?? null,
        prEvidencePath: body.prEvidencePath ?? "",
        status: body.status ?? "",
      });
      setMessage(
        body.status === "pull_request_created"
          ? "Governed pull request created. Not merged. Not deployed."
          : "PR packet prepared (no GitHub PR created). Not merged. Not deployed.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "PR creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePushRemote() {
    const reason = pushReason.trim();
    if (!reason) {
      setError("Remote push approval reason is required.");
      return;
    }
    if (!latest?.id) {
      setError("No commit candidate to push.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/push-branch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: latest.id,
            remoteName: remoteName.trim() || "origin",
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        remoteRef?: string;
        pushEvidencePath?: string;
        branchName?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPushResult({
        remoteRef: body.remoteRef ?? "",
        pushEvidencePath: body.pushEvidencePath ?? "",
        branchName: body.branchName ?? latest.branchName,
      });
      setMessage("Remote branch pushed. No PR created. Not merged. Not deployed.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Remote branch push failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePrepare() {
    const reason = prepareReason.trim();
    if (!reason) {
      setError("Operator reason is required.");
      return;
    }
    const msg = commitMessage.trim();
    if (!msg) {
      setError("Commit message is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/commit-candidate/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commitMessage: msg,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
            qualityGateOverride,
          }),
        },
      );
      const body = (await res.json()) as { error?: string; prDraftPath?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage("Commit/PR candidate prepared (artifacts only — not committed or pushed).");
      if (body.prDraftPath) {
        await loadPrPreview(body.prDraftPath);
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Prepare commit candidate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface as="section" id="commit-candidate" className="scroll-mt-28" tabIndex={-1}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Commit / PR candidate</h2>
        <Badge variant="muted">Artifacts only</Badge>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        This prepares a commit candidate only. This does not commit. This does not push. This does
        not merge. This does not deploy. This does not mark the run complete. Approved review
        sign-off is required.
      </p>

      {message ? <p className="mb-2 text-sm text-[var(--success)]">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
        <p className="mb-2 font-medium">Evidence context</p>
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          <li>Review sign-off: {signoff?.decision ?? "—"}</li>
          <li>Patch application: {evidence?.patchApplication?.status ?? "—"}</li>
          <li>Quality gates: {evidence?.postApplyQualityGates?.status ?? "not_run"}</li>
        </ul>
      </div>

      {canPrepare ? (
        <div className="mb-4 space-y-2">
          <label className="block text-xs font-medium" htmlFor="commit-message">
            Proposed commit message
          </label>
          <textarea
            id="commit-message"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={3}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="feat: describe the Hermes-applied change"
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="prepare-reason">
            Operator reason (required)
          </label>
          <textarea
            id="prepare-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={prepareReason}
            onChange={(e) => setPrepareReason(e.target.value)}
            disabled={busy}
          />
          {evidence?.postApplyQualityGates?.overallStatus === "failed" ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={qualityGateOverride}
                onChange={(e) => setQualityGateOverride(e.target.checked)}
                disabled={busy}
              />
              Quality gate override (document in reason)
            </label>
          ) : null}
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !commitMessage.trim() || !prepareReason.trim()}
            onClick={() => void handlePrepare()}
          >
            {busy ? "Preparing…" : "Prepare commit candidate"}
          </button>
        </div>
      ) : (
        <p className="mb-4 text-sm text-[var(--muted)]">
          Requires approved review sign-off and an applied Hermes patch.
        </p>
      )}

      {canLocalCommit ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Local governed commit (Phase 12B)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This creates a local git commit only.</li>
            <li>This does not push.</li>
            <li>This does not create a PR.</li>
            <li>This does not merge.</li>
            <li>This does not deploy.</li>
          </ul>
          <label className="block text-xs font-medium" htmlFor="local-commit-reason">
            Local commit approval reason (required)
          </label>
          <textarea
            id="local-commit-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={localCommitReason}
            onChange={(e) => setLocalCommitReason(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !localCommitReason.trim()}
            onClick={() => void handleLocalCommit()}
          >
            {busy ? "Committing…" : "Create local commit"}
          </button>
        </div>
      ) : null}

      {localCommitResult || latest?.localCommitHash ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Local commit recorded</p>
          <p className="font-mono text-xs">
            hash: {localCommitResult?.commitHash ?? latest?.localCommitHash}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence: {localCommitResult?.commitEvidencePath ?? latest?.localCommitEvidencePath}
          </p>
          {latest?.notPushed !== false && !pushResult && !latest?.remoteRef ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Not pushed yet. Not merged. Not deployed. Run is not marked complete.
            </p>
          ) : null}
        </div>
      ) : null}

      {canPushRemote ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Governed remote branch push (Phase 12C)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This pushes a remote branch only.</li>
            <li>This does not create a PR.</li>
            <li>This does not merge.</li>
            <li>This does not deploy.</li>
          </ul>
          <p className="text-xs text-[var(--muted)]">
            Remote: <span className="font-mono">{remoteName}</span> → branch{" "}
            <span className="font-mono">{latest?.branchName}</span>
          </p>
          <label className="block text-xs font-medium" htmlFor="push-reason">
            Remote push approval reason (required)
          </label>
          <textarea
            id="push-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={pushReason}
            onChange={(e) => setPushReason(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !pushReason.trim()}
            onClick={() => void handlePushRemote()}
          >
            {busy ? "Pushing…" : "Push governed branch"}
          </button>
        </div>
      ) : null}

      {pushResult || latest?.remoteRef ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Remote branch pushed</p>
          <p className="font-mono text-xs">
            ref: {pushResult?.remoteRef ?? latest?.remoteRef}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence: {pushResult?.pushEvidencePath ?? latest?.remotePushEvidencePath}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            No PR created. Not merged. Not deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canCreatePr ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Governed pull request (Phase 13)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This creates or prepares a pull request only.</li>
            <li>This does not merge.</li>
            <li>This does not deploy.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <p className="text-xs text-[var(--muted)]">
            Head branch: <span className="font-mono">{latest?.remoteBranchName ?? latest?.branchName}</span>
          </p>
          <p className="text-xs text-[var(--muted)]">
            PR title (from task): {latest?.commitMessage ?? "—"}
          </p>
          <label className="block text-xs font-medium" htmlFor="base-branch">
            Base branch
          </label>
          <input
            id="base-branch"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="pr-reason">
            PR creation approval reason (required)
          </label>
          <textarea
            id="pr-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={prReason}
            onChange={(e) => setPrReason(e.target.value)}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            {githubPrAvailable ? (
              <button
                type="button"
                className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
                disabled={busy || !prReason.trim()}
                onClick={() => void handleCreatePr("create_pr")}
              >
                {busy ? "Creating…" : "Create governed PR"}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              disabled={busy || !prReason.trim()}
              onClick={() => void handleCreatePr("prepare_packet")}
            >
              {busy ? "Preparing…" : "Prepare PR packet"}
            </button>
          </div>
        </div>
      ) : null}

      {prResult || latest?.prUrl || latest?.prStatus ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Pull request recorded</p>
          {prResult?.pullRequestUrl ?? latest?.prUrl ? (
            <p className="font-mono text-xs">
              url: {prResult?.pullRequestUrl ?? latest?.prUrl}
            </p>
          ) : (
            <p className="text-xs text-[var(--muted)]">No GitHub PR URL (packet-only mode).</p>
          )}
          {(prResult?.pullRequestNumber ?? latest?.prNumber) ? (
            <p className="font-mono text-xs">
              number: {prResult?.pullRequestNumber ?? latest?.prNumber}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence: {prResult?.prEvidencePath ?? latest?.prEvidencePath}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not merged. Not deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canRecordMergeReadiness ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Merge readiness review (Phase 14)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This records merge readiness only.</li>
            <li>This does not merge.</li>
            <li>This does not deploy.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>PR status: {latest?.prStatus ?? latest?.status ?? "—"}</p>
            {latest?.prUrl ? <p className="font-mono">url: {latest.prUrl}</p> : null}
            {latest?.prNumber ? <p className="font-mono">number: {latest.prNumber}</p> : null}
            <p>
              branches:{" "}
              <span className="font-mono">
                {latest?.prBaseBranch ?? "main"} ← {latest?.prHeadBranch ?? latest?.remoteBranchName}
              </span>
            </p>
            <p className="font-mono">commit: {latest?.localCommitHash}</p>
            <p>Quality gates: {evidence?.postApplyQualityGates?.overallStatus ?? "—"}</p>
            <p>Sign-off: {signoff?.decision ?? "—"} ({signoff?.reviewer ?? "—"})</p>
          </div>
          <label className="block text-xs font-medium" htmlFor="merge-readiness-decision">
            Decision
          </label>
          <select
            id="merge-readiness-decision"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
            value={mergeReadinessDecision}
            onChange={(e) =>
              setMergeReadinessDecision(e.target.value as "ready" | "not_ready" | "blocked")
            }
            disabled={busy}
          >
            <option value="ready">ready</option>
            <option value="not_ready">not_ready</option>
            <option value="blocked">blocked</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="merge-readiness-reason">
            Operator reason (required)
          </label>
          <textarea
            id="merge-readiness-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={mergeReadinessReason}
            onChange={(e) => setMergeReadinessReason(e.target.value)}
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="merge-readiness-notes">
            Notes (optional)
          </label>
          <textarea
            id="merge-readiness-notes"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={mergeReadinessNotes}
            onChange={(e) => setMergeReadinessNotes(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !mergeReadinessReason.trim()}
            onClick={() => void handleRecordMergeReadiness()}
          >
            {busy ? "Recording…" : "Record merge readiness"}
          </button>
        </div>
      ) : null}

      {mergeReadinessResult ||
      latest?.mergeReadinessDecision ||
      latest?.mergeReadinessStatus === "merge_readiness_recorded" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Merge readiness recorded</p>
          <p className="text-xs">
            decision:{" "}
            {mergeReadinessResult?.decision ?? latest?.mergeReadinessDecision ?? "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence:{" "}
            {mergeReadinessResult?.mergeReadinessPath ?? latest?.mergeReadinessEvidencePath}
          </p>
          {latest?.mergeReadinessReviewedAt ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              reviewed: {latest.mergeReadinessReviewedBy} at {latest.mergeReadinessReviewedAt}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not merged. Not deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canMergePr ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Governed PR merge (Phase 15)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This merges the pull request.</li>
            <li>This does not deploy.</li>
            <li>This does not mark the run complete.</li>
            <li>This does not delete the branch.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>PR: {latest?.prUrl}</p>
            <p>number: {latest?.prNumber}</p>
            <p>merge readiness: {latest?.mergeReadinessDecision ?? "—"}</p>
            <p>Quality gates: {evidence?.postApplyQualityGates?.overallStatus ?? "—"}</p>
            <p>Sign-off: {signoff?.decision ?? "—"}</p>
          </div>
          <label className="block text-xs font-medium" htmlFor="merge-method">
            Merge method
          </label>
          <select
            id="merge-method"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
            value={mergeMethod}
            onChange={(e) =>
              setMergeMethod(e.target.value as "squash" | "merge" | "rebase")
            }
            disabled={busy}
          >
            <option value="squash">squash</option>
            <option value="merge">merge</option>
            <option value="rebase">rebase</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="merge-reason">
            Merge approval reason (required)
          </label>
          <textarea
            id="merge-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={mergeReason}
            onChange={(e) => setMergeReason(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !mergeReason.trim()}
            onClick={() => void handleMergePr()}
          >
            {busy ? "Merging…" : "Merge governed PR"}
          </button>
        </div>
      ) : null}

      {mergeResult || latest?.mergeStatus === "pull_request_merged" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Pull request merged</p>
          <p className="text-xs">
            url: {mergeResult?.pullRequestUrl ?? latest?.prUrl ?? "—"}
          </p>
          {(mergeResult?.mergeCommitSha ?? latest?.mergeCommitSha) ? (
            <p className="font-mono text-xs">
              merge commit: {mergeResult?.mergeCommitSha ?? latest?.mergeCommitSha}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence: {mergeResult?.mergeEvidencePath ?? latest?.mergeEvidencePath}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not deployed. Run is not marked complete. Branch was not deleted.
          </p>
        </div>
      ) : null}

      {canRecordDeployReadiness ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Deploy readiness review (Phase 16)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This records deploy readiness only.</li>
            <li>This does not deploy.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>Merge status: {latest?.mergeStatus ?? latest?.status ?? "—"}</p>
            <p className="font-mono">PR: {latest?.prUrl ?? "—"}</p>
            <p className="font-mono">number: {latest?.prNumber ?? "—"}</p>
            <p className="font-mono">
              merge commit: {latest?.mergeCommitSha ?? "—"}
            </p>
            <p>Quality gates: {evidence?.postApplyQualityGates?.overallStatus ?? "—"}</p>
            <p>Sign-off: {signoff?.decision ?? "—"} ({signoff?.reviewer ?? "—"})</p>
          </div>
          <label className="block text-xs font-medium" htmlFor="deploy-readiness-decision">
            Decision
          </label>
          <select
            id="deploy-readiness-decision"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
            value={deployReadinessDecision}
            onChange={(e) =>
              setDeployReadinessDecision(e.target.value as "ready" | "not_ready" | "blocked")
            }
            disabled={busy}
          >
            <option value="ready">ready</option>
            <option value="not_ready">not_ready</option>
            <option value="blocked">blocked</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="deploy-readiness-reason">
            Operator reason (required)
          </label>
          <textarea
            id="deploy-readiness-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={deployReadinessReason}
            onChange={(e) => setDeployReadinessReason(e.target.value)}
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="deploy-readiness-notes">
            Notes (optional)
          </label>
          <textarea
            id="deploy-readiness-notes"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={deployReadinessNotes}
            onChange={(e) => setDeployReadinessNotes(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !deployReadinessReason.trim()}
            onClick={() => void handleRecordDeployReadiness()}
          >
            {busy ? "Recording…" : "Record deploy readiness"}
          </button>
        </div>
      ) : null}

      {deployReadinessResult ||
      latest?.deployReadinessDecision ||
      latest?.deployReadinessStatus === "deploy_readiness_recorded" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Deploy readiness recorded</p>
          <p className="text-xs">
            decision:{" "}
            {deployReadinessResult?.decision ?? latest?.deployReadinessDecision ?? "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence:{" "}
            {deployReadinessResult?.deployReadinessPath ?? latest?.deployReadinessEvidencePath}
          </p>
          {latest?.deployReadinessReviewedAt ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              reviewed: {latest.deployReadinessReviewedBy} at {latest.deployReadinessReviewedAt}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canPrepareDeploymentPacket ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Deployment packet (Phase 17)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This prepares a deployment packet only.</li>
            <li>This does not deploy.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>
              Deploy readiness: {latest?.deployReadinessDecision ?? "—"} (
              {latest?.deployReadinessStatus ?? "—"})
            </p>
            <p>Merge status: {latest?.mergeStatus ?? latest?.status ?? "—"}</p>
            <p className="font-mono">
              merge commit: {latest?.mergeCommitSha ?? "—"}
            </p>
            <p>Quality gates: {evidence?.postApplyQualityGates?.overallStatus ?? "—"}</p>
            <p>Sign-off: {signoff?.decision ?? "—"} ({signoff?.reviewer ?? "—"})</p>
          </div>
          <label className="block text-xs font-medium" htmlFor="deployment-target-environment">
            Target environment
          </label>
          <select
            id="deployment-target-environment"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
            value={deploymentTargetEnvironment}
            onChange={(e) => setDeploymentTargetEnvironment(e.target.value)}
            disabled={busy}
          >
            <option value="staging">staging</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="deployment-packet-reason">
            Operator reason (required)
          </label>
          <textarea
            id="deployment-packet-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={deploymentPacketReason}
            onChange={(e) => setDeploymentPacketReason(e.target.value)}
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="deployment-notes">
            Deployment notes (optional)
          </label>
          <textarea
            id="deployment-notes"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={deploymentNotes}
            onChange={(e) => setDeploymentNotes(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !deploymentPacketReason.trim()}
            onClick={() => void handlePrepareDeploymentPacket()}
          >
            {busy ? "Preparing…" : "Prepare deployment packet"}
          </button>
        </div>
      ) : null}

      {deploymentPacketResult ||
      latest?.deploymentPacketStatus === "deployment_packet_prepared" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Deployment packet prepared</p>
          <p className="text-xs">
            target:{" "}
            {deploymentPacketResult?.targetEnvironment ??
              latest?.deploymentTargetEnvironment ??
              "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            packet:{" "}
            {deploymentPacketResult?.deploymentPacketPath ?? latest?.deploymentPacketPath}
          </p>
          <p className="font-mono text-xs text-[var(--muted)]">
            plan: {deploymentPacketResult?.deploymentPlanPath ?? latest?.deploymentPlanPath}
          </p>
          {latest?.deploymentPacketCreatedAt ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              prepared: {latest.deploymentPacketCreatedBy} at {latest.deploymentPacketCreatedAt}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canDeployToStaging ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Staging deployment (Phase 18)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This deploys to staging only.</li>
            <li>This does not deploy to production.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>
              Deployment packet: {latest?.deploymentPacketStatus ?? latest?.status ?? "—"}
            </p>
            <p>Target environment: staging</p>
            <p>Adapter: local-script ({stagingDeployAdapterAvailable ? "available" : "unavailable"})</p>
            <p className="font-mono">
              script: scripts/deploy-staging.sh
            </p>
          </div>
          <label className="block text-xs font-medium" htmlFor="staging-deploy-reason">
            Operator reason (required)
          </label>
          <textarea
            id="staging-deploy-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={stagingDeployReason}
            onChange={(e) => setStagingDeployReason(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !stagingDeployReason.trim() || !stagingDeployAdapterAvailable}
            onClick={() => void handleDeployToStaging()}
          >
            {busy ? "Deploying…" : "Deploy to staging"}
          </button>
        </div>
      ) : null}

      {latest?.deploymentPacketStatus === "deployment_packet_prepared" &&
      !stagingDeployAdapterAvailable &&
      latest.status !== "staging_deployed" &&
      latest.status !== "staging_deployment_failed" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-xs text-[var(--muted)]">
          Staging deployment adapter unavailable. Add{" "}
          <span className="font-mono">scripts/deploy-staging.sh</span> to the target repository.
        </div>
      ) : null}

      {stagingDeployResult ||
      latest?.stagingDeploymentStatus === "staging_deployed" ||
      latest?.stagingDeploymentStatus === "staging_deployment_failed" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">
            {latest?.stagingDeploymentStatus === "staging_deployment_failed" ||
            stagingDeployResult?.status === "staging_deployment_failed"
              ? "Staging deployment failed"
              : "Staging deployment completed"}
          </p>
          <p className="text-xs">
            status: {stagingDeployResult?.status ?? latest?.stagingDeploymentStatus ?? "—"}
          </p>
          <p className="text-xs">
            exit code: {stagingDeployResult?.exitCode ?? latest?.stagingDeploymentExitCode ?? "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence:{" "}
            {stagingDeployResult?.deploymentEvidencePath ?? latest?.stagingDeploymentEvidencePath}
          </p>
          {latest?.stagingDeploymentFinishedAt ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              deployed: {latest.stagingDeployedBy} finished {latest.stagingDeploymentFinishedAt}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not production. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {canRecordProductionReadiness ? (
        <div className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Production readiness review (Phase 19)</p>
          <ul className="list-inside list-disc text-xs text-[var(--danger)]">
            <li>This records production readiness only.</li>
            <li>This does not deploy to production.</li>
            <li>This does not mark the run complete.</li>
          </ul>
          <div className="rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--muted)]">
            <p>
              Staging deployment: {latest?.stagingDeploymentStatus ?? latest?.status ?? "—"}
            </p>
            <p>
              exit code: {latest?.stagingDeploymentExitCode ?? "—"}
            </p>
            <p className="font-mono break-all">
              staging evidence: {latest?.stagingDeploymentEvidencePath ?? "—"}
            </p>
            <p>
              deployment packet: {latest?.deploymentPacketStatus ?? "—"}
            </p>
          </div>
          <label className="block text-xs font-medium" htmlFor="production-readiness-decision">
            Decision
          </label>
          <select
            id="production-readiness-decision"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs"
            value={productionReadinessDecision}
            onChange={(e) =>
              setProductionReadinessDecision(e.target.value as "ready" | "not_ready" | "blocked")
            }
            disabled={busy}
          >
            <option value="ready">ready</option>
            <option value="not_ready">not_ready</option>
            <option value="blocked">blocked</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="production-readiness-reason">
            Operator reason (required)
          </label>
          <textarea
            id="production-readiness-reason"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={productionReadinessReason}
            onChange={(e) => setProductionReadinessReason(e.target.value)}
            disabled={busy}
          />
          <label className="block text-xs font-medium" htmlFor="production-verification-notes">
            Verification notes (optional)
          </label>
          <textarea
            id="production-verification-notes"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
            rows={2}
            value={productionVerificationNotes}
            onChange={(e) => setProductionVerificationNotes(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            disabled={busy || !productionReadinessReason.trim()}
            onClick={() => void handleRecordProductionReadiness()}
          >
            {busy ? "Recording…" : "Record production readiness"}
          </button>
        </div>
      ) : null}

      {productionReadinessResult ||
      latest?.productionReadinessDecision ||
      latest?.productionReadinessStatus === "production_readiness_recorded" ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
          <p className="mb-1 font-medium">Production readiness recorded</p>
          <p className="text-xs">
            decision:{" "}
            {productionReadinessResult?.decision ?? latest?.productionReadinessDecision ?? "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            evidence:{" "}
            {productionReadinessResult?.productionReadinessEvidencePath ??
              latest?.productionReadinessEvidencePath}
          </p>
          {latest?.productionReadinessReviewedAt ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              reviewed: {latest.productionReadinessReviewedBy} at{" "}
              {latest.productionReadinessReviewedAt}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not production deployed. Run is not marked complete.
          </p>
        </div>
      ) : null}

      {latest ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm">
          <p className="mb-2 font-medium">Latest candidate</p>
          {latest.status ? (
            <p className="text-xs text-[var(--muted)]">status: {latest.status}</p>
          ) : null}
          <p className="text-[var(--muted)]">
            Branch recommendation: <span className="font-mono">{latest.branchName}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">message: {latest.commitMessage}</p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            files: {latest.changedFiles.join(", ")}
          </p>
          <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
            packet: {latest.commitPacketPath}
          </p>
          <p className="break-all font-mono text-xs text-[var(--muted)]">
            PR draft: {latest.prDraftPath}
          </p>
          {prPreview ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--surface-inset)] p-2 text-xs">
              {prPreview}
            </pre>
          ) : null}
        </div>
      ) : null}

      {history.length > 1 ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-[var(--muted)]">Prior candidates</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-[var(--muted)]">
            {history.slice(1).map((row) => (
              <li key={row.id}>
                {row.createdAt}: {row.branchName}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Surface>
  );
}
