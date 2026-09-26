export type RunDecisionGate = {
  label: string;
  status: string;
};

export type RunDecisionCheck = {
  id: string;
  title: string;
  why: string;
  status: string;
};

export type RunDecisionBrief = {
  title: string;
  happening: string;
  recommendation: string;
  canApprove: boolean;
  blocked: boolean;
  files: string[];
  gates: RunDecisionGate[];
  issues: string[];
  checks: RunDecisionCheck[];
};

const NOISE_ISSUE =
  /required review stage|approval is blocked until|senior review required before approval/i;

export const REVIEW_STAGE_OPERATOR_COPY: Record<string, { title: string; fallbackWhy: string }> = {
  architecture_review: {
    title: "Architecture check",
    fallbackWhy: "This change may affect how parts of the system fit together.",
  },
  implementation_review: {
    title: "The actual change",
    fallbackWhy: "Files were edited. Approving means you accept that work.",
  },
  risky_diff_review: {
    title: "Higher-risk change",
    fallbackWhy: "This looks more sensitive than a small edit.",
  },
  release_readiness_review: {
    title: "Ready to accept",
    fallbackWhy: "Automatic checks were skipped or policy asked a human to look.",
  },
};

export function operatorReviewStageCopy(stage: string, reason?: string | null): { title: string; why: string } {
  const known = REVIEW_STAGE_OPERATOR_COPY[stage];
  if (known) {
    return { title: known.title, why: known.fallbackWhy };
  }
  const why = (reason ?? "").trim();
  return {
    title: stage.replace(/_/g, " "),
    why: why || "This check still needs a human look.",
  };
}

function publicGateLabel(command: string | undefined): string {
  const trimmed = (command ?? "check").trim().split(/\s+/)[0] ?? "check";
  return trimmed.replace(/\/(?:home|mnt|tmp|Users)\/\S+/g, "that-command").slice(0, 80);
}

function publicIssue(issue: string): string {
  return issue
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s"'`]+/g, "that folder")
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "…")
    .slice(0, 160);
}

export function buildRunDecisionBrief(input: {
  taskTitle: string;
  happening: string;
  recommendation: string;
  canApprove: boolean;
  hardBlocked?: boolean;
  changedFiles: string[];
  qualityGates: Array<{ command?: string; status?: string }>;
  governanceIssues: string[];
  extraIssues?: string[];
  pendingChecks?: Array<{ id?: string; stage: string; reason?: string | null; status?: string }>;
  pendingReviewCount?: number;
}): RunDecisionBrief {
  const files = input.changedFiles.map((file) => file.slice(0, 120)).slice(0, 12);
  const gates = input.qualityGates.slice(0, 8).map((gate) => ({
    label: publicGateLabel(gate.command),
    status: (gate.status ?? "unknown").replace(/_/g, " "),
  }));
  const issues = [...input.governanceIssues, ...(input.extraIssues ?? [])]
    .map((issue) => publicIssue(issue.trim()))
    .filter((issue) => issue && !NOISE_ISSUE.test(issue))
    .slice(0, 6);
  const checks = (input.pendingChecks ?? [])
    .filter((check) => check.status === "pending" || !check.status)
    .slice(0, 6)
    .map((check) => {
      const copy = operatorReviewStageCopy(check.stage, check.reason);
      return {
        id: check.id ?? check.stage,
        title: copy.title,
        why: copy.why,
        status: "pending",
      };
    });
  if (checks.length === 0 && (input.pendingReviewCount ?? 0) > 0) {
    checks.push({
      id: "pending-review",
      title: "Human checks",
      why: "This job still needs a named human look. They will list here in a moment.",
      status: "pending",
    });
  }
  const recommendation =
    checks.length > 0
      ? "If the files and skipped checks look acceptable, approve with a short reason. That records every check below. Send back if something looks wrong."
      : input.recommendation.trim();

  return {
    title: input.taskTitle.trim() || "This job",
    happening: input.happening.trim(),
    recommendation,
    canApprove: input.canApprove,
    blocked: Boolean(input.hardBlocked),
    files,
    gates,
    issues,
    checks,
  };
}

export function buildRecommendedApprovalRationale(brief: RunDecisionBrief): string {
  const files = brief.files.length ? brief.files.join(", ") : "the changed files";
  const skippedGates = brief.gates.some((gate) => gate.status === "skipped");
  const failedGates = brief.gates.some((gate) => gate.status === "failed");
  const pendingChecks = brief.checks.filter((check) => check.status === "pending");

  if (brief.blocked || failedGates) {
    return `Sending back: policy or automatic checks blocked this run. Please address the failures and re-run.`;
  }

  const parts = [`Reviewed ${files} for ${brief.title}.`];
  if (skippedGates) {
    parts.push("Automatic tests did not run, so I read the diff manually.");
  }
  if (pendingChecks.length) {
    const labels = pendingChecks.map((check) => check.title.toLowerCase()).join(" and ");
    parts.push(`Acknowledging the pending ${labels} checks.`);
  }
  parts.push("Accepting this change to record my decision and move forward.");
  return parts.join(" ");
}

export function buildRecommendedSendBackRationale(brief: RunDecisionBrief): string {
  const files = brief.files.length ? brief.files.join(", ") : "the changed files";
  if (brief.issues.length) {
    return `Sending back ${brief.title}: ${brief.issues[0]}`;
  }
  if (brief.gates.some((gate) => gate.status === "failed")) {
    return `Sending back ${brief.title}: automatic checks failed on ${files}. Please fix and re-run.`;
  }
  return `Sending back ${brief.title}: the implementation on ${files} does not match the brief yet. Please revise and re-run.`;
}

export function formatPendingDecisionForChat(brief: RunDecisionBrief): string {
  const files = brief.files.length ? brief.files.join(", ") : "none listed";
  const gates = brief.gates.length
    ? brief.gates.map((gate) => `${gate.label} ${gate.status}`).join("; ")
    : "none listed";
  const checks = brief.checks.length
    ? brief.checks.map((check) => `${check.title}: ${check.why}`).join("; ")
    : "none pending";
  return [
    `A job is waiting for a human yes or no in this chat: ${brief.title}.`,
    `What happened: ${brief.happening}`,
    `Files: ${files}`,
    `Automatic checks: ${gates}`,
    `Human checks: ${checks}`,
    `Recommendation: ${brief.recommendation}`,
    "Answer in plain language. Propose recovery strategies and coding help. Approve and Send back are human buttons in this chat — do not press them. Do not send the operator to the Runs tab. Map tabs are optional developer extras.",
  ].join("\n");
}
