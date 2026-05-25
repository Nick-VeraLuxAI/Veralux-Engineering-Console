export const RELEASE_CHECKLIST_STATUSES = [
  "complete",
  "needs_attention",
  "blocked",
  "not_started",
] as const;

export type ReleaseChecklistStatus = (typeof RELEASE_CHECKLIST_STATUSES)[number];

export const RELEASE_CHECKLIST_ITEM_STATUSES = [
  "complete",
  "needs_attention",
  "blocked",
  "not_started",
] as const;

export type ReleaseChecklistItemStatus = (typeof RELEASE_CHECKLIST_ITEM_STATUSES)[number];

export const RELEASE_CHECKLIST_ITEM_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export type ReleaseChecklistItemSeverity = (typeof RELEASE_CHECKLIST_ITEM_SEVERITIES)[number];

export interface ReleaseChecklistItem {
  id: string;
  label: string;
  status: ReleaseChecklistItemStatus;
  severity: ReleaseChecklistItemSeverity;
  summary: string;
  referenceId: string | null;
  referenceHash: string | null;
  recommendedAction: string;
}

export interface ReleaseChecklistEvaluation {
  runId: string;
  status: ReleaseChecklistStatus;
  evaluatedAt: string;
  items: ReleaseChecklistItem[];
  blockers: string[];
  needsAttention: string[];
  recommendedAction: string;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
}

export interface ReleaseChecklistRecord {
  id: string;
  runId: string;
  status: ReleaseChecklistStatus;
  checklistJson: string;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ReleaseChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseChecklistError";
  }
}
