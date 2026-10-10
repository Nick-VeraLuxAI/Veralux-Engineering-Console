export const START_RUN_CHECKBOX_LABEL = "Start Autonomous Run after creating this task";

export type DraftTaskKind = "task";

export type DraftTaskJob = {
  id: string;
  kind: DraftTaskKind;
  repo: string;
  title: string;
  objective: string;
  acceptanceCriteria: string;
  startRunAfterCreate: boolean;
  sourcePrompt?: string;
  sourceSummary?: string;
  constraints?: string | null;
  repoId?: string | null;
};

export type DraftJobInvalidReason =
  | "title required"
  | "title cannot be the start-run checkbox label"
  | "body required"
  | "repo missing"
  | "duplicate title and body"
  | "start-run must be an explicit boolean";

export type DraftJobValidation = {
  valid: boolean;
  reasons: DraftJobInvalidReason[];
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isStartRunCheckboxLabel(value: unknown): boolean {
  return trimText(value).toLowerCase() === START_RUN_CHECKBOX_LABEL.toLowerCase();
}

export function parseExplicitBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function defaultStartRunAfterCreate(): false {
  return false;
}

export function draftJobFingerprint(input: { title?: unknown; objective?: unknown; body?: unknown }): string {
  const title = trimText(input.title).toLowerCase();
  const body = trimText(input.objective || input.body).toLowerCase();
  return `${title}\n${body}`;
}

export function validateDraftTaskJob(
  input: {
    title?: unknown;
    objective?: unknown;
    body?: unknown;
    repo?: unknown;
    repoId?: unknown;
    startRunAfterCreate?: unknown;
  },
  duplicates?: Set<string>,
): DraftJobValidation {
  const reasons: DraftJobInvalidReason[] = [];
  const title = trimText(input.title);
  const body = trimText(input.objective || input.body);
  const repo = trimText(input.repo) || trimText(input.repoId);

  if (!title) reasons.push("title required");
  if (isStartRunCheckboxLabel(title)) reasons.push("title cannot be the start-run checkbox label");
  if (!body) reasons.push("body required");
  if (!repo) reasons.push("repo missing");
  if (parseExplicitBoolean(input.startRunAfterCreate) === null) {
    reasons.push("start-run must be an explicit boolean");
  }
  if (duplicates?.has(draftJobFingerprint({ title, objective: body }))) {
    reasons.push("duplicate title and body");
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateDraftTaskJobs(
  jobs: Array<{
    title?: unknown;
    objective?: unknown;
    body?: unknown;
    repo?: unknown;
    repoId?: unknown;
    startRunAfterCreate?: unknown;
  }>,
): DraftJobValidation[] {
  const seen = new Set<string>();
  return jobs.map((job) => {
    const result = validateDraftTaskJob(job, seen);
    seen.add(draftJobFingerprint(job));
    return result;
  });
}

const TITLE_LINE = /^(?:title)\s*[:.-]\s*(.+)$/im;
const OBJECTIVE_BLOCK =
  /^(?:objective|body)\s*[:.-]\s*([\s\S]+?)(?=^(?:acceptance(?:\s+criteria)?|success(?:\s+criteria)?|constraints)\s*[:.-]|\s*$)/im;
const ACCEPTANCE_BLOCK =
  /^(?:acceptance(?:\s+criteria)?|success(?:\s+criteria)?)\s*[:.-]\s*([\s\S]+?)(?=^(?:constraints)\s*[:.-]|\s*$)/im;
const CONSTRAINTS_BLOCK = /^(?:constraints)\s*[:.-]\s*([\s\S]+)/im;

function firstLine(value: string): string {
  return value.split(/\n/)[0]?.trim() ?? "";
}

export function parseDraftFieldsFromPhrase(phrase: string): {
  title: string | null;
  objective: string | null;
  acceptanceCriteria: string | null;
  constraints: string | null;
  sourcePrompt: string;
} {
  const trimmed = phrase.trim();
  const titled = trimmed.match(TITLE_LINE);
  const objectiveBlock = trimmed.match(OBJECTIVE_BLOCK);
  const acceptanceBlock = trimmed.match(ACCEPTANCE_BLOCK);
  const constraintsBlock = trimmed.match(CONSTRAINTS_BLOCK);

  let title = titled ? firstLine(titled[1] ?? "") : "";
  let objective = objectiveBlock?.[1]?.trim() ?? "";
  const acceptanceCriteria = acceptanceBlock?.[1]?.trim() || null;
  const constraints = constraintsBlock?.[1]?.trim() || null;

  if (!title || !objective) {
    const withoutMeta = trimmed
      .replace(TITLE_LINE, "")
      .replace(OBJECTIVE_BLOCK, "")
      .replace(ACCEPTANCE_BLOCK, "")
      .replace(CONSTRAINTS_BLOCK, "")
      .trim();
    const lines = withoutMeta.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (!title && lines[0] && !isStartRunCheckboxLabel(lines[0])) {
      title = lines[0].replace(/^(?:job\s+\d+|task\s+\d+)\s*[:.-]\s*/i, "").slice(0, 80);
      if (!objective && lines.length > 1) {
        objective = lines.slice(1).join("\n");
      }
    }
  }

  if (isStartRunCheckboxLabel(title)) title = "";
  if (!objective) objective = title;

  return {
    title: title.trim() || null,
    objective: objective.trim() || null,
    acceptanceCriteria,
    constraints,
    sourcePrompt: trimmed.slice(0, 800),
  };
}
