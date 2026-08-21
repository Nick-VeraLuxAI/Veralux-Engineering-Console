import type {
  AutonomousDocument,
  AutonomousFailureClass,
  DiagnosisResult,
} from "./types";
import {
  buildDeterministicDiagnosisFromEvidence,
  detectFailureSignaturesInText,
  findSymbolDependencyNeighborhood,
  parseUnboundIdentifierFindings,
  type StructuredDiagnosisFields,
} from "./feedback-convergence";

export function diagnoseIterationFailure(input: {
  document: AutonomousDocument;
  failureClass: AutonomousFailureClass;
  qcSummary?: string;
  validationErrors?: string[];
  executionErrors?: string[];
  evidenceText?: string;
  repoPath?: string;
}): DiagnosisResult {
  const lastAttempt = input.document.priorAttempts[input.document.priorAttempts.length - 1];
  const why =
    input.qcSummary ||
    input.validationErrors?.join("; ") ||
    input.executionErrors?.join("; ") ||
    lastAttempt?.summary ||
    "Previous iteration did not satisfy quality gates or validation.";

  const evidenceText = input.evidenceText || why;
  const signatures = detectFailureSignaturesInText(evidenceText);
  const unbound = parseUnboundIdentifierFindings(evidenceText).filter((u) => !u.isHookGlobal);
  const neighborhood =
    input.repoPath && unbound[0]
      ? findSymbolDependencyNeighborhood(
          input.repoPath,
          input.document.authorizedPathPrefixes ?? ["src/"],
          unbound[0].symbol,
        )
      : null;

  if (signatures.length > 0 || (input.evidenceText && input.evidenceText.length > 0)) {
    return buildDeterministicDiagnosisFromEvidence({
      failureClass: input.failureClass,
      evidenceText,
      qcSummary: input.qcSummary ?? why,
      failedHypothesis: lastAttempt?.strategy ?? input.document.strategy ?? undefined,
      signatures,
      dependencyNeighborhood: neighborhood,
    });
  }

  const filesToInspect = [
    ...input.document.qcObservations.flatMap((obs) => (obs.failedCommands.length > 0 ? ["package.json"] : [])),
  ];

  const suggestedStrategy =
    input.failureClass === "VALIDATION_FAILURE"
      ? "Revise the worker plan so paths, operations, and allowedFiles satisfy validation."
      : input.failureClass === "MODEL_OUTPUT_FAILURE"
        ? "Regenerate a parseable worker plan JSON; do not execute invalid output."
        : "Keep the same objective, change the implementation hypothesis, and produce a new validated worker plan.";

  const structured: StructuredDiagnosisFields = {
    observed_failure: why.slice(0, 220),
    evidence_quote_or_signature: evidenceText.slice(0, 280),
    affected_file_or_gate: "npm test",
    root_cause_hypothesis: suggestedStrategy,
    confidence: "medium",
    contradictory_evidence: "(none)",
    recommended_strategy_change: suggestedStrategy,
    avoid_repeating: "Do not repeat the failed hypothesis without new evidence.",
  };

  return {
    advisory: true,
    failureClass: input.failureClass,
    summary: `Iteration ${input.document.iterationNumber} failed (${input.failureClass}).`,
    failedHypothesis: lastAttempt?.strategy ?? input.document.strategy ?? "Previous change did not meet acceptance.",
    whyPreviousFailed: why,
    suggestedStrategy,
    filesToInspect: [...new Set(filesToInspect)].slice(0, 12),
    doNotMutate: true,
    authoritative: true,
    ...structured,
  };
}
