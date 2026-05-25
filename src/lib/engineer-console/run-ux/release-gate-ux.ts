import { RUN_PANEL_IDS } from "./run-ux-types";

export interface ReleaseGateChecklistItem {
  id: string;
  label: string;
  whyItMatters: string;
  ctaLabel: string;
  href: string;
  rawBlocker: string;
}

export interface ReleaseGateStatusPresentation {
  label: string;
  detail: string;
  tone: "muted" | "ready" | "warning" | "blocked";
}

function panelHref(id: string): string {
  return `#${id}`;
}

function normalizeBlocker(blocker: string): string {
  return blocker.trim().toLowerCase();
}

function mapBlockerToChecklistItem(blocker: string): ReleaseGateChecklistItem {
  const normalized = normalizeBlocker(blocker);

  if (normalized.includes("replay verification")) {
    return {
      id: `replay-${normalized}`,
      label: "Replay verification required",
      whyItMatters: "Release gates require replay verification to pass before the release can continue.",
      ctaLabel: "Go to Replay verification",
      href: panelHref(RUN_PANEL_IDS.replay),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("policy")) {
    return {
      id: `policy-${normalized}`,
      label: "Policy blocked",
      whyItMatters: "Governance policy must pass before merge, deployment, or release sign-off can continue.",
      ctaLabel: "Go to Policy results",
      href: panelHref(RUN_PANEL_IDS.policy),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("review stage")) {
    return {
      id: `review-${normalized}`,
      label: "Required review stages pending",
      whyItMatters: "Required human review must be complete before release-gated actions can proceed.",
      ctaLabel: "Go to Review stages",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("evidence bundle")) {
    return {
      id: `evidence-${normalized}`,
      label: "Evidence bundle required",
      whyItMatters: "Release-gated actions need the recorded evidence bundle for auditability and readiness checks.",
      ctaLabel: "Go to Evidence bundle",
      href: panelHref(RUN_PANEL_IDS.evidence),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("deployment approval")) {
    return {
      id: `deployment-approval-${normalized}`,
      label: "Deployment approval missing",
      whyItMatters: "Deployment execution requires an approved deployment gate record before it can run.",
      ctaLabel: "Go to Deployment gates",
      href: panelHref(RUN_PANEL_IDS.deploymentGates),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("health policy")) {
    return {
      id: `health-policy-${normalized}`,
      label: "Health policy needs attention",
      whyItMatters: "Release sign-off depends on the latest deployment health policy result.",
      ctaLabel: "Go to Deployment health policy",
      href: panelHref(RUN_PANEL_IDS.deploymentHealthPolicy),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("checklist")) {
    return {
      id: `checklist-${normalized}`,
      label: "Release checklist blocked",
      whyItMatters: "Release checklist blockers must be addressed before release-gated actions can proceed.",
      ctaLabel: "Go to Release checklist",
      href: panelHref(RUN_PANEL_IDS.releaseChecklist),
      rawBlocker: blocker,
    };
  }

  if (normalized.includes("sign-off") || normalized.includes("signoff")) {
    return {
      id: `signoff-${normalized}`,
      label: "Sign-off missing or rejected",
      whyItMatters: "Release sign-off decisions gate the final release flow and must be resolved explicitly.",
      ctaLabel: "Go to Release sign-off",
      href: panelHref(RUN_PANEL_IDS.releaseSignoff),
      rawBlocker: blocker,
    };
  }

  return {
    id: `generic-${normalized}`,
    label: "Release blocker requires review",
    whyItMatters: "This hard release gate blocker must be reviewed before the release can continue.",
    ctaLabel: "Go to release details",
    href: panelHref(RUN_PANEL_IDS.releaseChecklist),
    rawBlocker: blocker,
  };
}

export function buildReleaseGateChecklistItems(blockers: string[]): ReleaseGateChecklistItem[] {
  const items = blockers.map(mapBlockerToChecklistItem);
  const deduped: ReleaseGateChecklistItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.label}:${item.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function describeReleaseGateStatus(input: {
  enabled: boolean;
  status: string;
  blockers: string[];
  signals: {
    checklistStatus: string | null;
    signoffDecision: string | null;
    healthPolicyStatus: string | null;
    policyStatus: string | null;
    replayStatus: string | null;
  };
}): ReleaseGateStatusPresentation {
  if (!input.enabled) {
    return {
      label: "Release gates disabled",
      detail: "Checklist, deployment, and sign-off guidance remain visible, but hard release-gate enforcement is advisory in this mode.",
      tone: "muted",
    };
  }

  if (input.status === "blocked" || input.blockers.length > 0) {
    return {
      label: "Release gates enabled and blocked",
      detail: "Release cannot continue yet. Follow the checklist below to resolve the blocking items.",
      tone: "blocked",
    };
  }

  const hasWarnings =
    input.signals.policyStatus === "requires_review" ||
    input.signals.replayStatus === "warning" ||
    input.signals.healthPolicyStatus === "needs_attention" ||
    input.signals.checklistStatus === "needs_attention" ||
    input.signals.signoffDecision === "completed_with_exceptions";

  if (hasWarnings) {
    return {
      label: "Release gates enabled with warnings",
      detail: "Hard release gates are currently passing, but nearby release signals still need review.",
      tone: "warning",
    };
  }

  return {
    label: "Release gates enabled and passing",
    detail: "Hard release-gate checks are currently satisfied for this action.",
    tone: "ready",
  };
}
