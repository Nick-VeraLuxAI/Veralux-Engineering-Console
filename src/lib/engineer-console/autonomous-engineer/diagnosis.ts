import type {
  AutonomousDocument,
  AutonomousFailureClass,
  DiagnosisResult,
} from "./types";

export function diagnoseIterationFailure(input: {
  document: AutonomousDocument;
  failureClass: AutonomousFailureClass;
  qcSummary?: string;
  validationErrors?: string[];
  executionErrors?: string[];
}): DiagnosisResult {
  const lastAttempt = input.document.priorAttempts[input.document.priorAttempts.length - 1];
  const why =
    input.qcSummary ||
    input.validationErrors?.join("; ") ||
    input.executionErrors?.join("; ") ||
    lastAttempt?.summary ||
    "Previous iteration did not satisfy quality gates or validation.";

  const filesToInspect = [
    ...input.document.qcObservations.flatMap((obs) => (obs.failedCommands.length > 0 ? ["package.json"] : [])),
    ...(lastAttempt ? [] : []),
  ];

  const suggestedStrategy =
    input.failureClass === "VALIDATION_FAILURE"
      ? "Revise the worker plan so paths, operations, and allowedFiles satisfy validation."
      : input.failureClass === "MODEL_OUTPUT_FAILURE"
        ? "Regenerate a parseable worker plan JSON; do not execute invalid output."
        : "Keep the same objective, change the implementation hypothesis, and produce a new validated worker plan.";

  return {
    advisory: true,
    failureClass: input.failureClass,
    summary: `Iteration ${input.document.iterationNumber} failed (${input.failureClass}).`,
    failedHypothesis: lastAttempt?.strategy ?? input.document.strategy ?? "Previous change did not meet acceptance.",
    whyPreviousFailed: why,
    suggestedStrategy,
    filesToInspect: [...new Set(filesToInspect)].slice(0, 12),
    doNotMutate: true,
  };
}
