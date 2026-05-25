export interface PrStateReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  signals: {
    branchName: string | null;
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

function isCleanTreeManualRecovery(readiness: PrStateReadiness | null, latestRequest: PrStateRequest | null): boolean {
  return (
    includesAny(latestRequest?.errorMessage, [/no reusable run commit/i, /no changed files/i]) ||
    readiness?.blockers.some((blocker) => /no reusable run commit|no changed files/i.test(blocker)) === true
  );
}

function branchStateValue(latestRequest: PrStateRequest | null, readiness: PrStateReadiness | null): PrStateCardValue {
  const failure = latestRequest?.errorMessage ?? "";

  if (latestRequest?.status === "pr_created") {
    return {
      label: "Branch already pushed",
      detail: "A remote branch already exists for this PR record.",
    };
  }

  if (latestRequest?.status === "committed" || latestRequest?.status === "pushing") {
    return {
      label: "Branch needs push",
      detail: "The run commit exists locally and the next PR attempt will push the branch.",
    };
  }

  if (latestRequest?.status === "failed" && latestRequest.commitShaPrefix) {
    if (/push failed/i.test(failure)) {
      return {
        label: "Branch needs push",
        detail: "The previous attempt created or reused a commit, but push did not finish.",
      };
    }
    if (/gh pr create failed|unexpected gh pr create output|existing pr/i.test(failure) || latestRequest.prUrl) {
      return {
        label: "Branch already pushed",
        detail: "The remote branch already exists, so retry can skip a redundant push.",
      };
    }
    return {
      label: "Remote state unknown",
      detail: "A commit is recorded, but the last failure does not confirm whether the remote branch already exists.",
    };
  }

  if (readiness?.signals.branchName) {
    return {
      label: "Local branch only",
      detail: `PR creation will use branch ${readiness.signals.branchName}.`,
    };
  }

  return {
    label: "Remote state unknown",
    detail: "Branch state will be checked during PR creation.",
  };
}

function commitStateValue(latestRequest: PrStateRequest | null, readiness: PrStateReadiness | null): PrStateCardValue {
  if (isCleanTreeManualRecovery(readiness, latestRequest)) {
    return {
      label: "Clean tree with no reusable commit",
      detail:
        "Cannot continue automatically because the tree is clean and no known run commit was recorded.",
    };
  }

  if (latestRequest?.commitShaPrefix) {
    return {
      label: "Existing commit will be reused",
      detail: `Retry will reuse commit ${latestRequest.commitShaPrefix}. No duplicate commit will be created.`,
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

function prStateValue(latestRequest: PrStateRequest | null, readiness: PrStateReadiness | null): PrStateCardValue {
  if (latestRequest?.prUrl) {
    return {
      label: "Existing PR detected",
      detail: `PR #${latestRequest.prNumber ?? "?"} is already recorded for this run branch.`,
    };
  }

  if (latestRequest?.status === "failed" && latestRequest.commitShaPrefix) {
    return {
      label: "PR creation failed",
      detail: "Retry is available and will continue from the recorded run state instead of duplicating work.",
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

function readinessValue(latestRequest: PrStateRequest | null, readiness: PrStateReadiness | null): PrStateCardValue {
  if (latestRequest?.status === "pr_created") {
    return {
      label: "Created",
      detail: "A PR is already recorded for this run branch.",
    };
  }

  if (latestRequest?.status === "failed") {
    return {
      label: "Failed",
      detail: latestRequest.errorMessage ?? "The last PR attempt failed.",
    };
  }

  if (!readiness) {
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

  return {
    label: "Ready",
    detail: readiness.recommendedAction,
  };
}

function nextActionValue(
  latestRequest: PrStateRequest | null,
  readiness: PrStateReadiness | null,
  branch: PrStateCardValue,
): PrStateCardValue {
  if (latestRequest?.prUrl) {
    return {
      label: "Review existing PR",
      detail: "An existing PR is already recorded. Open it to continue review instead of creating another one.",
    };
  }

  if (isCleanTreeManualRecovery(readiness, latestRequest)) {
    return {
      label: "Manual recovery required",
      detail:
        "Restore the approved changes or resume from the existing run branch/commit before retrying PR creation.",
    };
  }

  if (latestRequest?.status === "failed" && latestRequest.commitShaPrefix) {
    const detail =
      branch.label === "Branch already pushed"
        ? "Retry draft PR creation. The next attempt will reuse the existing commit and skip push."
        : "Retry draft PR creation. The next attempt will reuse the existing commit and continue PR creation.";
    return {
      label: "Retry draft PR creation",
      detail,
    };
  }

  if (readiness?.status === "blocked") {
    return {
      label: "Fix blocker",
      detail: readiness.blockers[0] ?? "Resolve the current PR readiness blocker.",
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
  latestRequest: PrStateRequest | null,
  branch: PrStateCardValue,
  nextAction: PrStateCardValue,
): PrRetryGuidance | null {
  if (!latestRequest || latestRequest.status !== "failed") {
    return null;
  }

  const succeeded: string[] = [];
  if (latestRequest.commitShaPrefix) {
    succeeded.push(`Commit ${latestRequest.commitShaPrefix} already exists`);
  }
  if (branch.label === "Branch already pushed") {
    succeeded.push("Remote branch already exists");
  }
  if (latestRequest.prUrl) {
    succeeded.push(`PR already recorded: #${latestRequest.prNumber ?? "?"}`);
  }

  const failureReason = latestRequest.errorMessage ?? "The last PR attempt failed.";
  let lastFailedStep = "Create draft PR";
  if (/push failed/i.test(failureReason)) {
    lastFailedStep = "Push branch";
  } else if (/no reusable run commit|no changed files/i.test(failureReason)) {
    lastFailedStep = "Manual recovery";
  } else if (!latestRequest.commitShaPrefix) {
    lastFailedStep = "Create commit";
  }

  const duplicateProtection = latestRequest.commitShaPrefix
    ? `Retry will reuse commit ${latestRequest.commitShaPrefix}. No duplicate commit will be created.`
    : "Retry will only continue after the missing commit or change set is restored.";

  return {
    lastFailedStep,
    failureReason,
    succeeded,
    nextRetryStep: nextAction.detail,
    duplicateProtection,
  };
}

export function derivePrStateCardState(input: {
  readiness: PrStateReadiness | null;
  latestRequest: PrStateRequest | null;
}): PrStateCardState {
  const { readiness, latestRequest } = input;
  const branch = branchStateValue(latestRequest, readiness);
  const nextAction = nextActionValue(latestRequest, readiness, branch);
  const existingPr =
    latestRequest?.prUrl
      ? {
          url: latestRequest.prUrl,
          number: latestRequest.prNumber,
          stateLabel: "State not recorded in request history",
        }
      : null;

  const createButtonLabel =
    nextAction.label === "Review existing PR"
      ? "Existing PR recorded"
      : nextAction.label === "Retry draft PR creation"
      ? "Retry draft PR creation"
      : nextAction.label === "Create draft PR"
        ? "Create draft PR"
        : "Create draft PR";

  const createButtonDisabled =
    nextAction.label === "Fix blocker" ||
    nextAction.label === "Manual recovery required" ||
    nextAction.label === "Review existing PR";

  return {
    readiness: readinessValue(latestRequest, readiness),
    commit: commitStateValue(latestRequest, readiness),
    branch,
    pr: prStateValue(latestRequest, readiness),
    nextAction,
    retryGuidance: buildRetryGuidance(latestRequest, branch, nextAction),
    existingPr,
    rawStatuses: {
      readinessStatus: readiness?.status ?? null,
      requestStatus: latestRequest?.status ?? null,
      baseBranch: latestRequest?.baseBranch ?? null,
    },
    createButtonLabel,
    createButtonDisabled,
  };
}
