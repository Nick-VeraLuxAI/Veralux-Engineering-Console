export interface PrStateReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  signals: {
    branchName: string | null;
    runBranchName?: string | null;
    currentBranchName?: string | null;
    currentBranchMatchesRunBranch?: boolean;
    localRunBranchExists?: boolean;
    remoteBranchExists?: boolean;
    remoteBranchMatchesReusableCommit?: boolean;
    reusableCommitShaPrefix?: string | null;
    reusableCommitMessage?: string | null;
    reusableCommitSource?: string;
    canResume?: boolean;
    resumeReason?: string | null;
    manualRecoveryRequired?: boolean;
    manualRecoveryReason?: string | null;
    existingPrUrl?: string | null;
    existingPrNumber?: string | null;
  };
}

export interface PrStateRequest {
  id: string;
  status: string;
  readinessStatus: string;
  branchName: string;
  baseBranch: string;
  commitShaPrefix: string | null;
  prUrl: string | null;
  prNumber: string | null;
  errorMessage: string | null;
}

export interface PrStateCardValue {
  label: string;
  detail: string;
}

export interface PrRetryGuidance {
  lastFailedStep: string;
  failureReason: string;
  succeeded: string[];
  nextRetryStep: string;
  duplicateProtection: string;
}

export interface PrStateCardState {
  readiness: PrStateCardValue;
  commit: PrStateCardValue;
  branch: PrStateCardValue;
  pr: PrStateCardValue;
  nextAction: PrStateCardValue;
  retryGuidance: PrRetryGuidance | null;
  existingPr:
    | {
        url: string;
        number: string | null;
        stateLabel: string;
      }
    | null;
  rawStatuses: {
    readinessStatus: string | null;
    requestStatus: string | null;
    baseBranch: string | null;
  };
  createButtonLabel: string;
  createButtonDisabled: boolean;
}

function includesAny(value: string | null | undefined, patterns: RegExp[]): boolean {
  if (!value) return false;
  return patterns.some((pattern) => pattern.test(value));
}

function latestRequest(requests: PrStateRequest[]): PrStateRequest | null {
  return requests[0] ?? null;
}

function latestFailedRequest(requests: PrStateRequest[]): PrStateRequest | null {
  return requests.find((request) => request.status === "failed") ?? null;
}

function existingPrRequest(requests: PrStateRequest[]): PrStateRequest | null {
  return requests.find((request) => !!request.prUrl) ?? null;
}

function historicalCommitRequest(requests: PrStateRequest[]): PrStateRequest | null {
  return requests.find((request) => !!request.commitShaPrefix) ?? null;
}

function reusableCommitPrefix(readiness: PrStateReadiness | null, requests: PrStateRequest[]): string | null {
  return readiness?.signals.reusableCommitShaPrefix ?? historicalCommitRequest(requests)?.commitShaPrefix ?? null;
}

function isManualRecoveryRequired(readiness: PrStateReadiness | null, requests: PrStateRequest[]): boolean {
  if (readiness?.signals.manualRecoveryRequired !== undefined) {
    return readiness.signals.manualRecoveryRequired;
  }
  const failed = latestFailedRequest(requests);
  return (
    includesAny(failed?.errorMessage, [/no reusable run commit/i, /no changed files/i]) ||
    readiness?.blockers.some((blocker) => /no reusable run commit|no changed files/i.test(blocker)) === true
  );
}

function checkoutNote(readiness: PrStateReadiness | null): string {
  const runBranchName = readiness?.signals.runBranchName ?? readiness?.signals.branchName ?? null;
  if (!runBranchName || readiness?.signals.currentBranchMatchesRunBranch !== false) {
    return "";
  }
  return ` Current checkout differs from the run branch. Retry will first checkout ${runBranchName} before continuing.`;
}

function branchStateValue(readiness: PrStateReadiness | null, requests: PrStateRequest[]): PrStateCardValue {
  const runBranchName = readiness?.signals.runBranchName ?? latestRequest(requests)?.branchName ?? null;
  const note = checkoutNote(readiness);

  if (readiness?.signals.remoteBranchMatchesReusableCommit) {
    return {
      label: "Branch already pushed",
      detail:
        `Remote branch ${runBranchName ?? "for this run"} already exists and matches the reusable run commit. Push will be skipped.${note}`,
    };
  }

  if (reusableCommitPrefix(readiness, requests) && readiness?.signals.remoteBranchExists === false) {
    return {
      label: "Branch needs push",
      detail: `Run branch ${runBranchName ?? "for this run"} exists locally. Push is required because the remote branch is missing.${note}`,
    };
  }

  if (reusableCommitPrefix(readiness, requests) && readiness?.signals.remoteBranchExists) {
    return {
      label: "Branch needs push",
      detail: `Remote branch ${runBranchName ?? "for this run"} exists, but it does not yet match the reusable run commit. Retry will push the run branch before PR creation continues.${note}`,
    };
  }

  if (runBranchName && (readiness?.signals.localRunBranchExists ?? true)) {
    return {
      label: "Run branch exists locally",
      detail: note.length > 0 ? note.trimStart() : `PR creation will use run branch ${runBranchName}.`,
    };
  }

  return {
    label: "Remote state unknown",
    detail: "Branch state will be checked against the run branch during PR creation.",
  };
}

function commitStateValue(readiness: PrStateReadiness | null, requests: PrStateRequest[]): PrStateCardValue {
  if (isManualRecoveryRequired(readiness, requests)) {
    return {
      label: "Clean tree with no reusable commit",
      detail:
        readiness?.signals.manualRecoveryReason ??
        "Cannot continue automatically because the tree is clean and no known run commit was recorded.",
    };
  }

  const reusableCommit = reusableCommitPrefix(readiness, requests);
  if (reusableCommit) {
    return {
      label: "Existing commit will be reused",
      detail: `Retry will reuse commit ${reusableCommit}. No duplicate commit will be created.`,
    };
  }

  if (readiness && readiness.status !== "blocked") {
    return {
      label: "Commit will be created",
      detail: "The next successful PR attempt will create a controlled run commit before pushing.",
    };
  }

  return {
    label: "No commit yet",
    detail: "No reusable run commit is currently recorded for this run.",
  };
}

function prStateValue(readiness: PrStateReadiness | null, requests: PrStateRequest[]): PrStateCardValue {
  const existingPr = existingPrRequest(requests);
  if (readiness?.signals.existingPrUrl || existingPr?.prUrl) {
    return {
      label: "Existing PR detected",
      detail: `PR #${readiness?.signals.existingPrNumber ?? existingPr?.prNumber ?? "?"} is already recorded for this run branch.`,
    };
  }

  const failed = latestFailedRequest(requests);
  if (failed && (readiness?.signals.canResume || reusableCommitPrefix(readiness, requests))) {
    return {
      label: "Draft PR can be created",
      detail: "Retry is available and will continue from the recorded run state instead of duplicating work.",
    };
  }

  if (failed) {
    return {
      label: "PR creation failed",
      detail: "Previous PR creation failed. Review the failure context below before retrying.",
    };
  }

  if (!readiness) {
    return {
      label: "No PR state yet",
      detail: "Evaluate PR readiness to see whether a draft PR can be created.",
    };
  }

  if (readiness.status === "blocked") {
    return {
      label: "No PR yet",
      detail: "PR creation is blocked until the readiness blockers are resolved.",
    };
  }

  return {
    label: "Draft PR can be created",
    detail: "The console will attempt draft PR creation after readiness checks pass.",
  };
}

function readinessValue(readiness: PrStateReadiness | null, requests: PrStateRequest[]): PrStateCardValue {
  if (readiness?.signals.existingPrUrl || existingPrRequest(requests)?.prUrl) {
    return {
      label: "Created",
      detail: "A PR is already recorded for this run branch.",
    };
  }

  if (!readiness) {
    const failed = latestFailedRequest(requests);
    if (failed) {
      return {
        label: "Failed",
        detail: failed.errorMessage ?? "The last PR attempt failed.",
      };
    }
    return {
      label: "Not evaluated",
      detail: "Evaluate PR readiness to see the current blocker and retry state.",
    };
  }

  if (readiness.status === "blocked") {
    return {
      label: "Blocked",
      detail: readiness.blockers[0] ?? readiness.recommendedAction,
    };
  }

  if (readiness.status === "requires_review") {
    return {
      label: "Requires review",
      detail: readiness.recommendedAction,
    };
  }

  if (readiness.signals.canResume) {
    return {
      label: "Ready to retry",
      detail: readiness.recommendedAction,
    };
  }

  return {
    label: "Ready",
    detail: readiness.recommendedAction,
  };
}

function nextActionValue(
  readiness: PrStateReadiness | null,
  requests: PrStateRequest[],
  branch: PrStateCardValue,
): PrStateCardValue {
  if (readiness?.signals.existingPrUrl || existingPrRequest(requests)?.prUrl) {
    return {
      label: "Review existing PR",
      detail: "An existing PR is already recorded. Open it to continue review instead of creating another one.",
    };
  }

  if (isManualRecoveryRequired(readiness, requests)) {
    return {
      label: "Manual recovery required",
      detail:
        readiness?.signals.manualRecoveryReason ??
        "Restore the approved changes or resume from the existing run branch/commit before retrying PR creation.",
    };
  }

  if (readiness?.status === "blocked") {
    return {
      label: "Fix blocker",
      detail: readiness.blockers[0] ?? "Resolve the current PR readiness blocker.",
    };
  }

  if (readiness?.signals.canResume || reusableCommitPrefix(readiness, requests)) {
    const detail =
      branch.label === "Branch already pushed"
        ? "Retry draft PR creation. The next attempt will reuse the existing commit and skip push."
        : "Retry draft PR creation. The next attempt will reuse the existing commit and continue PR creation.";
    return {
      label: "Retry draft PR creation",
      detail,
    };
  }

  if (readiness?.status === "requires_review") {
    return {
      label: "Create draft PR",
      detail: "Review the warnings, provide rationale, and then create the draft PR.",
    };
  }

  return {
    label: "Create draft PR",
    detail: "Create the controlled commit and open a draft PR for downstream merge and release work.",
  };
}

function buildRetryGuidance(
  readiness: PrStateReadiness | null,
  requests: PrStateRequest[],
  branch: PrStateCardValue,
  existingPr: { url: string; number: string | null; stateLabel: string } | null,
  nextAction: PrStateCardValue,
): PrRetryGuidance | null {
  const failed = latestFailedRequest(requests);
  if (!failed) {
    return null;
  }

  const succeeded: string[] = [];
  const reusableCommit = reusableCommitPrefix(readiness, requests);
  if (reusableCommit) {
    succeeded.push(`Existing run commit ${reusableCommit} is available for reuse`);
  }
  if (branch.label === "Branch already pushed") {
    succeeded.push("Remote run branch already matches the reusable commit");
  } else if (readiness?.signals.localRunBranchExists) {
    succeeded.push("Run branch exists locally");
  }
  if (existingPr) {
    succeeded.push(`PR already recorded: #${existingPr.number ?? "?"}`);
  }

  const failureReason = failed.errorMessage ?? "The last PR attempt failed.";
  let lastFailedStep = "Create draft PR";
  if (/push failed/i.test(failureReason)) {
    lastFailedStep = "Push branch";
  } else if (/no reusable run commit|no changed files/i.test(failureReason)) {
    lastFailedStep = "Manual recovery";
  } else if (!failed.commitShaPrefix && !reusableCommit) {
    lastFailedStep = "Create commit";
  }

  const duplicateProtection = reusableCommit
    ? `Retry will reuse commit ${reusableCommit}. No duplicate commit will be created.`
    : "Retry will only continue after the missing commit or change set is restored.";

  return {
    lastFailedStep,
    failureReason,
    succeeded,
    nextRetryStep: nextAction.detail,
    duplicateProtection,
  };
}

function createButtonLabelFor(nextAction: PrStateCardValue): string {
  switch (nextAction.label) {
    case "Review existing PR":
      return "Existing PR recorded";
    case "Manual recovery required":
      return "Manual recovery required";
    case "Fix blocker":
      return "Fix blocker first";
    case "Retry draft PR creation":
      return "Retry draft PR creation";
    default:
      return "Create draft PR";
  }
}

export function derivePrStateCardState(input: {
  readiness: PrStateReadiness | null;
  requests: PrStateRequest[];
}): PrStateCardState {
  const { readiness, requests } = input;
  const latest = latestRequest(requests);
  const existingPr =
    readiness?.signals.existingPrUrl || existingPrRequest(requests)?.prUrl
      ? {
          url: readiness?.signals.existingPrUrl ?? existingPrRequest(requests)?.prUrl ?? "",
          number: readiness?.signals.existingPrNumber ?? existingPrRequest(requests)?.prNumber ?? null,
          stateLabel: "State not recorded in request history",
        }
      : null;
  const branch = branchStateValue(readiness, requests);
  const nextAction = nextActionValue(readiness, requests, branch);
  const createButtonLabel = createButtonLabelFor(nextAction);

  const createButtonDisabled =
    nextAction.label === "Fix blocker" ||
    nextAction.label === "Manual recovery required" ||
    nextAction.label === "Review existing PR";

  return {
    readiness: readinessValue(readiness, requests),
    commit: commitStateValue(readiness, requests),
    branch,
    pr: prStateValue(readiness, requests),
    nextAction,
    retryGuidance: buildRetryGuidance(readiness, requests, branch, existingPr, nextAction),
    existingPr,
    rawStatuses: {
      readinessStatus: readiness?.status ?? null,
      requestStatus: latest?.status ?? null,
      baseBranch: latest?.baseBranch ?? null,
    },
    createButtonLabel,
    createButtonDisabled,
  };
}
