import type { InvestigationResult } from "./investigation";
import {
  classifyUnknown,
  classifyUnknowns,
  extractUnknownStatements,
  requiresDirectorClarification,
  requiresGovernanceEscalation,
} from "./unknown-classifier";
import type { ObjectiveInterpretation } from "./types";

export interface InterpretObjectiveInput {
  objective: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  investigation: InvestigationResult;
}

function sentencesFrom(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

export function interpretObjective(input: InterpretObjectiveInput): ObjectiveInterpretation {
  const lines = sentencesFrom(input.objective);
  const objectiveSummary = lines[0] ?? input.objective.slice(0, 240);
  const requirements = lines.length > 1 ? lines.slice(1) : [objectiveSummary];
  const acceptanceCriteria =
    input.acceptanceCriteria && input.acceptanceCriteria.length > 0
      ? input.acceptanceCriteria
      : [`The change satisfies: ${objectiveSummary}`];
  const constraints = [
    ...(input.constraints ?? []),
    "Mutations only via validated worker plans.",
    "Quality gates remain allowlisted.",
    "No PR, merge, deploy, or self-approval.",
  ];

  const unknownStatements = extractUnknownStatements(input.objective);
  const whole = classifyUnknown(input.objective);
  if (whole.classification === "governance" || whole.classification === "director") {
    unknownStatements.push(input.objective);
  }
  const unknowns = classifyUnknowns(unknownStatements);

  for (const unknown of unknowns) {
    if (unknown.classification !== "discoverable") continue;
    const haystack = [
      input.investigation.contextSummary,
      JSON.stringify(input.investigation.packageScripts),
      input.investigation.observations.map((item) => item.summary).join("\n"),
    ].join("\n");
    if (haystack.toLowerCase().includes("test") && /test/i.test(unknown.statement)) {
      unknown.resolved = true;
      unknown.resolution = "Resolved from package.json scripts / repo investigation.";
    } else if (haystack.length > 0) {
      unknown.resolved = true;
      unknown.resolution = "Resolved from constrained investigation; not a director question.";
    }
  }

  const remainingDirector = requiresDirectorClarification(unknowns);
  const remainingGovernance = requiresGovernanceEscalation(unknowns);

  const clarificationQuestions = unknowns
    .filter((item) => !item.resolved && (item.classification === "director" || item.classification === "governance"))
    .map((item) => item.statement);

  return {
    objectiveSummary,
    requirements,
    acceptanceCriteria,
    constraints,
    assumptions: [
      "Authorized repository is the only mutation target.",
      "Human gates remain for PR/merge/deploy/sign-off.",
    ],
    unknowns,
    clarificationRequired: remainingDirector || remainingGovernance,
    clarificationQuestions,
    initialInvestigationTargets: input.investigation.fileTree.slice(0, 20),
  };
}
