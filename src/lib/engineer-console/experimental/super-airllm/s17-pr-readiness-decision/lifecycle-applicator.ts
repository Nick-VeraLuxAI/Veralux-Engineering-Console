/** Default lifecycle applicator that reuses the existing Phase 2X PR-preparation gate. */

import {
  prepareVeraPullRequest,
  type PrepareVeraPullRequestResult,
} from "../../../bridge/prepare-vera-pull-request";
import {
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
} from "../../../worker/vera-pull-request-preparation-types";
import type { LifecycleApplyResult, PrReadinessLifecycleDecision } from "./types";

/**
 * Builds an applyLifecycle callback that calls the existing
 * `prepareVeraPullRequest` implementation (Phase 2X) when the operator marks
 * the run PR-ready. Not-ready and revision decisions do not transition the run.
 *
 * PR creation (Phase 2Y, `CREATE VERA PULL REQUEST`) is never invoked here.
 */
export function createExistingPrReadinessLifecycleApplicator(): (input: {
  runId: string;
  decision: PrReadinessLifecycleDecision;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
}) => LifecycleApplyResult & { result?: PrepareVeraPullRequestResult } {
  return (input) => {
    const prior = {
      priorStatus: "waiting_for_approval",
      priorStep: "implementation_commit_created",
    };
    if (input.decision !== "mark_pr_ready") {
      // Not-ready / revision: no lifecycle transition; PR preparation is not created.
      return {
        nextStep: prior.priorStep,
        runStatus: "waiting_for_approval",
        priorStep: prior.priorStep,
        priorStatus: prior.priorStatus,
      };
    }
    if (input.confirmationText !== VERA_PULL_REQUEST_PREPARATION_CONFIRMATION) {
      throw new Error("confirmation_invalid");
    }
    // prepareVeraPullRequest is async; the applicator contract here is sync for
    // fixture use. For live use, prefer the async applicator below.
    throw new Error("use_async_pr_readiness_applicator_for_live_prepare");
  };
}

/**
 * Async applicator for live use: actually calls prepareVeraPullRequest.
 * Returned separately so tests can inject a synchronous mock.
 */
export async function applyPrReadinessLifecycleLive(input: {
  runId: string;
  decision: PrReadinessLifecycleDecision;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
}): Promise<LifecycleApplyResult & { result?: PrepareVeraPullRequestResult }> {
  const priorStep = "implementation_commit_created";
  if (input.decision !== "mark_pr_ready") {
    return {
      nextStep: priorStep,
      runStatus: "waiting_for_approval",
      priorStep,
      priorStatus: "waiting_for_approval",
    };
  }
  const result = await prepareVeraPullRequest({
    runId: input.runId,
    confirmationText: input.confirmationText,
    requestedBy: input.requestedBy,
    note: input.note ?? null,
  });
  return {
    nextStep: result.nextStep,
    runStatus: result.run.status,
    priorStep,
    priorStatus: "waiting_for_approval",
    result,
  };
}
