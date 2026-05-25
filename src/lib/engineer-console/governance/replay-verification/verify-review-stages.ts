import { listReviewStagesForRun } from "../review-stages/review-stage-manager";
import type { DecisionRecord } from "../decision-records/decision-record-types";
import type { ReplayCheck } from "./replay-verification-types";

function passed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "passed", message, details };
}

function failed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "failed", message, details };
}

function warning(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "warning", message, details };
}

export function verifyReviewStagesAtApproval(
  runId: string,
  records: DecisionRecord[],
): ReplayCheck[] {
  const checks: ReplayCheck[] = [];
  const approved = records.filter((r) => r.decision === "approved");
  if (approved.length === 0) {
    return checks;
  }

  const finalApproval = approved[approved.length - 1]!;
  const stages = listReviewStagesForRun(runId);
  const stagesAtDecision = stages.filter((s) => s.createdAt <= finalApproval.createdAt);
  const requiredAtDecision = stagesAtDecision.filter((s) => s.required);

  if (requiredAtDecision.length === 0) {
    checks.push(
      passed("REVIEW_STAGES_AT_APPROVAL", "No required review stages existed at approval time."),
    );
    return checks;
  }

  const incomplete = requiredAtDecision.filter((stage) => {
    if (stage.status !== "approved") return true;
    if (!stage.completedAt) return true;
    return stage.completedAt > finalApproval.createdAt;
  });

  if (incomplete.length > 0) {
    checks.push(
      failed(
        "REVIEW_STAGES_AT_APPROVAL",
        "Approved decision recorded before required review stages were completed.",
        {
          stageIds: incomplete.map((s) => s.id),
          stages: incomplete.map((s) => s.stage),
        },
      ),
    );
    return checks;
  }

  checks.push(
    passed("REVIEW_STAGES_AT_APPROVAL", "Required review stages were completed before approval.", {
      requiredCount: requiredAtDecision.length,
    }),
  );

  const pendingNow = listReviewStagesForRun(runId).filter(
    (s) => s.required && s.status === "pending",
  );
  if (pendingNow.length > 0) {
    checks.push(
      warning("REVIEW_STAGES_PENDING", "Required review stages are still pending after approval.", {
        stages: pendingNow.map((s) => s.stage),
      }),
    );
  }

  return checks;
}
