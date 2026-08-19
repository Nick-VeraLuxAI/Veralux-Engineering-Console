import type { ClassifiedUnknown, UnknownClass } from "./types";

const GOVERNANCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(merge|merging)\b.*\b(main|master|production)\b/i, reason: "Merge to a protected branch is a human release gate." },
  { pattern: /\b(create|open|submit)\b.*\b(pull request|pr)\b/i, reason: "Pull request creation is a human release gate." },
  { pattern: /\bdeploy(ment|ing)?\b.*\b(prod|production|staging)\b/i, reason: "Deploy is a human release gate." },
  { pattern: /\b(approve|sign[- ]off|self-authori[sz]e)\b/i, reason: "Approval and sign-off require a human approver." },
  { pattern: /\bbypass\b.*\b(validation|quality gate|policy)\b/i, reason: "Bypassing validation or QC is forbidden." },
];

const DIRECTOR_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(should we|do you want|which (one|option|name|library|api))\b/i, reason: "Product choice requires a director decision." },
  { pattern: /\b(foo or bar|option a or option b|rename the public)\b/i, reason: "Public API / naming choice is a director decision." },
  { pattern: /\b(breaking change|accept(able)? breakage)\b/i, reason: "Breaking-change acceptance is a director decision." },
  { pattern: /\b(product (name|direction|priority)|scope (increase|cut))\b/i, reason: "Product scope is a director decision." },
];

const DISCOVERABLE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(what|which|does|is there|find|locate|discover)\b.*\b(test|script|file|config|export|function|path|package\.json)\b/i, reason: "Answerable from the repository without a human." },
  { pattern: /\b(existing|current)\b.*\b(test|implementation|api|schema)\b/i, reason: "Current code shape is discoverable." },
  { pattern: /\bhow (is|does|do)\b/i, reason: "How-the-code-works questions are discoverable." },
];

export function classifyUnknown(statement: string): { classification: UnknownClass; reason: string } {
  const text = statement.trim();
  if (isProhibitionOfProtectedAction(text)) {
    return {
      classification: "engineering",
      reason: "A prohibition of PR/merge/deploy is a constraint, not a request to perform a human release gate.",
    };
  }
  for (const rule of GOVERNANCE_PATTERNS) {
    if (rule.pattern.test(text)) {
      return { classification: "governance", reason: rule.reason };
    }
  }
  for (const rule of DIRECTOR_PATTERNS) {
    if (rule.pattern.test(text)) {
      return { classification: "director", reason: rule.reason };
    }
  }
  for (const rule of DISCOVERABLE_PATTERNS) {
    if (rule.pattern.test(text)) {
      return { classification: "discoverable", reason: rule.reason };
    }
  }
  return {
    classification: "engineering",
    reason: "Default: treat as an engineering unknown to investigate or solve, not a human question.",
  };
}

export function classifyUnknowns(statements: string[]): ClassifiedUnknown[] {
  return statements.map((statement, index) => {
    const { classification, reason } = classifyUnknown(statement);
    return {
      id: `unknown-${index + 1}`,
      statement,
      classification,
      reason,
      resolved: false,
    };
  });
}

export function requiresDirectorClarification(unknowns: ClassifiedUnknown[]): boolean {
  return unknowns.some((item) => item.classification === "director" && !item.resolved);
}

export function requiresGovernanceEscalation(unknowns: ClassifiedUnknown[]): boolean {
  return unknowns.some((item) => item.classification === "governance" && !item.resolved);
}

export function discoverableUnknowns(unknowns: ClassifiedUnknown[]): ClassifiedUnknown[] {
  return unknowns.filter((item) => item.classification === "discoverable" && !item.resolved);
}

export function extractUnknownStatements(objective: string): string[] {
  const questions = objective
    .split(/(?<=[?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.endsWith("?"));
  return questions;
}

function isProhibitionOfProtectedAction(text: string): boolean {
  return (
    /\b(do not|don't|never|without|must not)\b/i.test(text) &&
    /\b(pr|pull request|merge|deploy|sign[- ]off)\b/i.test(text)
  );
}
