export const VERA_HANDOFF_DESCRIPTION_HEADING = "## Engineering request from VeraLux OS";
export const VERA_HANDOFF_SOURCE = "veralux-os";
export const VERA_HANDOFF_NON_EXECUTION_NOTE = "This request does not execute code.";
export const VERA_WORK_ORDER_MODULE_PREFIX = "vera-work-order:";
export const VERA_IMPLEMENTATION_RUN_PREPARED_STEP = "vera_implementation_prepared";
export const VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE =
  "PREPARE VERA IMPLEMENTATION RUN";
export const VERA_EXECUTION_APPROVAL_REQUESTED_STEP = "vera_execution_approval_requested";
export const VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE =
  "REQUEST VERA EXECUTION APPROVAL";
export const VERA_EXECUTION_APPROVAL_REQUESTED_NOTE =
  "Execution approval requested only. No code was executed." as const;

export type VeraRunGovernanceNotes = {
  veraHandoff?: boolean;
  veraWorkOrderId?: string | null;
  preparedBy?: string;
  preparedAt?: string;
  veraExecutionApprovalRequested?: boolean;
  requestedBy?: string;
  requestedAt?: string;
  nonExecutionNote?: string;
};

export function parseVeraRunGovernanceNotes(
  governanceNotes: string | null | undefined,
): VeraRunGovernanceNotes {
  if (!governanceNotes?.trim()) return {};
  try {
    return JSON.parse(governanceNotes) as VeraRunGovernanceNotes;
  } catch {
    return {};
  }
}

export function isVeraHandoffRunFromGovernanceNotes(
  governanceNotes: string | null | undefined,
): boolean {
  return parseVeraRunGovernanceNotes(governanceNotes).veraHandoff === true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VeraHandoffTaskAnalysis = {
  isVeraLuxOsHandoffTask: boolean;
  source: typeof VERA_HANDOFF_SOURCE | null;
  veraWorkOrderId: string | null;
  nonExecutionNotePresent: boolean;
  taskIsDraft: boolean;
  repoBindingPresent: boolean;
  repoPath: string | null;
  safeToPrepareRun: boolean;
  blockers: string[];
};

export function isVeraLuxOsHandoffDescription(description: string): boolean {
  if (!description.includes(VERA_HANDOFF_DESCRIPTION_HEADING)) return false;
  return /\*\*Source:\*\*\s*veralux-os/.test(description);
}

export function extractVeraWorkOrderIdFromDescription(description: string): string | null {
  const jsonMatch = description.match(
    /### Business context[\s\S]*?```json\s*([\s\S]*?)\s*```/,
  );
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { module?: string };
      const moduleValue = parsed.module?.trim() ?? "";
      if (moduleValue.startsWith(VERA_WORK_ORDER_MODULE_PREFIX)) {
        const workOrderId = moduleValue.slice(VERA_WORK_ORDER_MODULE_PREFIX.length);
        if (UUID_PATTERN.test(workOrderId)) return workOrderId;
      }
    } catch {
      /* fall through to instruction marker */
    }
  }

  const sourceMatch = description.match(/Source work order ID:\s*([0-9a-f-]{36})/i);
  if (sourceMatch?.[1] && UUID_PATTERN.test(sourceMatch[1])) {
    return sourceMatch[1]!;
  }

  return null;
}

export function hasVeraHandoffNonExecutionNote(description: string): boolean {
  return description.includes(VERA_HANDOFF_NON_EXECUTION_NOTE);
}
