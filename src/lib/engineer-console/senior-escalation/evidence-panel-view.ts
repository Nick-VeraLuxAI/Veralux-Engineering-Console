import type { EvidenceSeniorReviewSummary } from "./durable-types";

export const SENIOR_REVIEW_EVIDENCE_PANEL_V1_ID = "senior-review-evidence-panel-v1" as const;
export const SENIOR_REVIEW_EVIDENCE_PANEL_WIRED_INTO_AE_LOOP = false;

export const SENIOR_REVIEW_ADVISORY_COPY =
  "Senior review is advisory only. Human approval gates remain required.";

export const SENIOR_REVIEW_ADVISORY_EMPTY =
  "No senior review advisory evidence for this run.";

const EVIDENCE_PANEL_UNSAFE =
  /127\.0\.0\.1|:1919|:8082|:8081|ENGINEER_CONSOLE|\/mnt\/model-storage|localhost|secret|password|api[_-]?key|sk-[a-z0-9]|checkpoint\//i;

const RELEASE_AUTHORITY =
  /senior approved|approved the run|approved the pr|approved merge|approved deploy|bypass (qc|human)|replaced qc/i;

export type SeniorReviewEvidencePanelView = {
  present: boolean;
  emptyLabel: string | null;
  title: "Senior Review Advisory";
  advisoryCopy: typeof SENIOR_REVIEW_ADVISORY_COPY;
  advisoryOnly: true;
  humanGatesStillRequired: true;
  statusLabel: string | null;
  escalationReasons: string[];
  blockedReasonLabels: string[];
  rootCausePreview: string | null;
  nextWorkerMissionPreview: string | null;
  qcGates: string[];
  riskLabels: string[];
  warnings: string[];
  updatedAt: string | null;
};

function safeText(value: string | null | undefined): string | null {
  if (!value) return null;
  return EVIDENCE_PANEL_UNSAFE.test(value) ? null : value;
}

function safeList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !EVIDENCE_PANEL_UNSAFE.test(value))
    .slice(0, 12);
}

export function evidencePanelContainsUnsafeConfigLeak(value: unknown): boolean {
  return EVIDENCE_PANEL_UNSAFE.test(JSON.stringify(value));
}

export function evidencePanelImpliesReleaseAuthority(value: unknown): boolean {
  return RELEASE_AUTHORITY.test(JSON.stringify(value));
}

export function toSeniorReviewEvidencePanelView(
  summary: EvidenceSeniorReviewSummary | null | undefined,
): SeniorReviewEvidencePanelView {
  if (!summary || summary.advisoryOnly !== true || summary.humanGatesStillRequired !== true) {
    return {
      present: false,
      emptyLabel: SENIOR_REVIEW_ADVISORY_EMPTY,
      title: "Senior Review Advisory",
      advisoryCopy: SENIOR_REVIEW_ADVISORY_COPY,
      advisoryOnly: true,
      humanGatesStillRequired: true,
      statusLabel: null,
      escalationReasons: [],
      blockedReasonLabels: [],
      rootCausePreview: null,
      nextWorkerMissionPreview: null,
      qcGates: [],
      riskLabels: [],
      warnings: [],
      updatedAt: null,
    };
  }

  const view: SeniorReviewEvidencePanelView = {
    present: true,
    emptyLabel: null,
    title: "Senior Review Advisory",
    advisoryCopy: SENIOR_REVIEW_ADVISORY_COPY,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    statusLabel: safeText(summary.statusLabel),
    escalationReasons: safeList(summary.escalationReasons),
    blockedReasonLabels: safeList(summary.blockedReasonLabels),
    rootCausePreview: safeText(summary.rootCausePreview),
    nextWorkerMissionPreview: safeText(summary.nextWorkerMissionPreview),
    qcGates: safeList(summary.qcGates),
    riskLabels: safeList(summary.riskLabels),
    warnings: safeList(summary.warnings),
    updatedAt: safeText(summary.updatedAt),
  };

  if (evidencePanelContainsUnsafeConfigLeak(view) || evidencePanelImpliesReleaseAuthority(view)) {
    return {
      ...view,
      present: false,
      emptyLabel: SENIOR_REVIEW_ADVISORY_EMPTY,
      statusLabel: null,
      escalationReasons: [],
      blockedReasonLabels: [],
      rootCausePreview: null,
      nextWorkerMissionPreview: null,
      qcGates: [],
      riskLabels: [],
      warnings: [],
      updatedAt: null,
    };
  }

  return view;
}
