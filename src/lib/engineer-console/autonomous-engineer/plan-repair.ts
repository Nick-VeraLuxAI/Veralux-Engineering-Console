/**
 * PLAN_REPAIR vs ENGINEERING_ITERATION accounting (clean-convergence WP3–WP5).
 * Pre-execution deterministic failures do not burn semantic engineering iterations.
 */
import type { AutonomousAuthorityEnvelope, AutonomousBudgetConfig, AutonomousBudgetUsage } from "./types";

export type IterationChargeKind =
  | "PLAN_REPAIR"
  | "ENGINEERING_ITERATION"
  | "POST_REVIEW_REPAIR";

export type PlanRepairKind =
  | "unauthorized_path"
  | "invalid_op"
  | "malformed_plan"
  | "protected_path"
  | "invalid_content"
  | "harness_incompat"
  | "truncating_update"
  | "scaffold_contract"
  | "invalid_syntax"
  | "model_output"
  | "generation_repair";

export interface PlanRepairRecord {
  at: string;
  semanticIteration: number;
  kind: PlanRepairKind;
  reason: string;
  evidence: string[];
}

export interface PlanFailureClassification {
  chargeKind: IterationChargeKind;
  planRepairKind?: PlanRepairKind;
  reason: string;
  evidence: string[];
}

const PACKAGE_METADATA_RE = /(^|\/)package\.json$/i;

/** Precise unauthorized-path feedback (WP4). */
export function formatUnauthorizedPathFeedback(
  rejectedPaths: string[],
  authorizedPrefixes: string[],
): string {
  const prefixes =
    authorizedPrefixes.length > 0 ? authorizedPrefixes.join(", ") : "(none — empty envelope)";
  const lines = [
    `Rejected unauthorized path(s): ${rejectedPaths.join(", ")}.`,
    "Reason: path is outside the authorized mutation scope.",
    `Authorized prefixes: ${prefixes}.`,
  ];
  if (rejectedPaths.some((p) => PACKAGE_METADATA_RE.test(p.replace(/\\/g, "/")))) {
    lines.push(
      "Do not modify package metadata (package.json); read it for investigation/test-runner grounding only.",
    );
  }
  lines.push("Only mutate files under the authorized prefixes listed above.");
  return lines.join(" ");
}

export function classifyPreExecutionPlanFailure(input: {
  failureClass: string;
  message: string;
  unauthorizedPaths?: string[];
  authority?: AutonomousAuthorityEnvelope | null;
}): PlanFailureClassification {
  const message = input.message.trim();
  const evidence = [message].filter(Boolean);

  if (input.unauthorizedPaths && input.unauthorizedPaths.length > 0) {
    const reason = formatUnauthorizedPathFeedback(
      input.unauthorizedPaths,
      input.authority?.authorizedPathPrefixes ?? [],
    );
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "unauthorized_path",
      reason,
      evidence: [...evidence, ...input.unauthorizedPaths],
    };
  }

  if (/outside authorized|unauthorized path|not authorized/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "unauthorized_path",
      reason: message,
      evidence,
    };
  }

  if (/LITERAL_ESCAPED_NEWLINES|literal \\n|escaped newlines/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "invalid_content",
      reason: message,
      evidence,
    };
  }

  if (
    /ESM_REQUIRE_USAGE|INVALID_NODE_ASSERT_API|INVALID_NODE_TEST_EXPECT|VITEST_HOOK|INVENTED_TEST_RUNNER|harness/i.test(
      message,
    )
  ) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "harness_incompat",
      reason: message,
      evidence,
    };
  }

  if (/truncat|update_file.*must include complete|create_file.*already exists/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "truncating_update",
      reason: message,
      evidence,
    };
  }

  if (/syntax error in src\/|operation \d+ syntax error|Expected '|parse error/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "invalid_syntax",
      reason: [
        "Planned TypeScript does not parse — fix syntax before execution.",
        "Common issues: missing commas, broken imports, truncated files, JSON-escaped quotes in content.",
        "Use complete valid TypeScript file bodies in update_file/create_file operations.",
        message,
      ].join(" "),
      evidence,
    };
  }

  if (/SCAFFOLD_CONTRACT_REGRESSION|Protected export.*removed from src\/contracts|regresses protected scaffold|contracts\.ts is frozen|context-assembler lost|memory-record-store lost/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "scaffold_contract",
      reason: [
        "Protected scaffold files (contracts.ts, context-assembler.ts, memory-record-store.ts, event-log.ts) must not regress.",
        "For contracts.ts: use update_file with the COMPLETE current file plus additive edits only (new types, optional fields).",
        "For implementers: add new modules (e.g. context-budget-assembler.ts) instead of rewriting InMemoryContextAssembler return shape.",
        "Preserve MemoryRecord.kind, supersededById, AssembledContext fields (text, recordIds, eventIds, estimatedTokens), and store methods (upsert/get/list/supersede).",
        message,
      ].join(" "),
      evidence,
    };
  }

  if (/protected|node_modules|\.env|POLICY_BLOCK/i.test(message)) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "protected_path",
      reason: message,
      evidence,
    };
  }

  if (
    input.failureClass === "MODEL_OUTPUT_FAILURE" ||
    input.failureClass === "GENERATION_BUDGET_EXHAUSTED" ||
    /not a worker plan|malformed|parse|JSON|schema|invalid op|run_shell|operations|GENERATION_REPAIR_FAILED/i.test(
      message,
    )
  ) {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind:
        input.failureClass === "GENERATION_BUDGET_EXHAUSTED" ||
        /GENERATION_REPAIR_FAILED|GENERATION_BUDGET_EXHAUSTED/i.test(message)
          ? "generation_repair"
          : input.failureClass === "MODEL_OUTPUT_FAILURE"
            ? "model_output"
            : "malformed_plan",
      reason: message,
      evidence,
    };
  }

  if (input.failureClass === "VALIDATION_FAILURE") {
    return {
      chargeKind: "PLAN_REPAIR",
      planRepairKind: "invalid_op",
      reason: message,
      evidence,
    };
  }

  // Real QC / semantic / resume failures must remain ENGINEERING_ITERATION (WP5).
  return {
    chargeKind: "ENGINEERING_ITERATION",
    reason: message,
    evidence,
  };
}

export function resolveMaxPlanRepairs(budget: AutonomousBudgetConfig): number {
  if (typeof budget.max_plan_repairs === "number" && budget.max_plan_repairs > 0) {
    return budget.max_plan_repairs;
  }
  return Math.max(budget.max_plans, 8);
}

export function wouldExceedPlanRepairs(
  budget: AutonomousBudgetConfig,
  usage: AutonomousBudgetUsage,
  increment = 1,
): boolean {
  return (usage.planRepairs ?? 0) + increment > resolveMaxPlanRepairs(budget);
}

export function isPlanRepairCharge(kind: IterationChargeKind | null | undefined): boolean {
  return kind === "PLAN_REPAIR";
}
