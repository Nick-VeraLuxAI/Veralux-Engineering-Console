import type { AlignmentQuestionnaireProposal } from "./alignment-questionnaire";
import type { CommissionTaskProposal } from "./commission-task-intent";
import type { MultitaskFleetProposal } from "./multitask-fleet-intent";
import type { StartRepoProposal } from "./start-repo-intent";
import { parseAlignmentQuestionnaire } from "./alignment-questionnaire";

export type MapChatProposal =
  | StartRepoProposal
  | CommissionTaskProposal
  | MultitaskFleetProposal
  | AlignmentQuestionnaireProposal;

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseFleetItem(value: unknown): StartRepoProposal | CommissionTaskProposal | undefined {
  const item = parseMapChatProposal(value);
  if (item?.type === "start_repo" || item?.type === "commission_task") return item;
  return undefined;
}

export function parseMapChatProposal(value: unknown): MapChatProposal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "start_repo") {
    return {
      type: "start_repo",
      name: nullableString(record.name),
      description: nullableString(record.description),
    };
  }
  if (record.type === "commission_task") {
    return {
      type: "commission_task",
      ...(typeof record.id === "string" && record.id ? { id: record.id } : {}),
      ...(record.kind === "task" ? { kind: "task" as const } : {}),
      title: nullableString(record.title),
      objective: nullableString(record.objective),
      success: nullableString(record.success),
      constraints: nullableString(record.constraints),
      repoId: nullableString(record.repoId),
      ...(typeof record.startRunAfterCreate === "boolean" ? { startRunAfterCreate: record.startRunAfterCreate } : {}),
      ...(typeof record.sourcePrompt === "string" ? { sourcePrompt: record.sourcePrompt } : {}),
      ...(typeof record.sourceSummary === "string" ? { sourceSummary: record.sourceSummary } : {}),
    };
  }
  if (record.type === "multitask_fleet" && Array.isArray(record.items)) {
    const items = record.items
      .map((item) => parseFleetItem(item))
      .filter((item): item is StartRepoProposal | CommissionTaskProposal => item !== undefined);
    if (items.length < 2) return undefined;
    return { type: "multitask_fleet", items };
  }
  return parseAlignmentQuestionnaire(value);
}
