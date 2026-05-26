import type {
  ChangedFileRiskSummary,
  DangerPointSeverity,
  IntelligencePathDomain,
} from "./danger-point-types";

export interface TaskIntentSummary {
  intents: Set<
    | "docs"
    | "tests"
    | "ui"
    | "release"
    | "deployment"
    | "auth"
    | "billing"
    | "database"
    | "staging"
  >;
  explicitPaths: string[];
  normalizedText: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "update",
  "add",
  "create",
  "change",
  "modify",
  "fix",
]);

const DOMAIN_RULES: Array<{
  domain: IntelligencePathDomain;
  pattern: RegExp;
  severity: DangerPointSeverity | null;
}> = [
  { domain: "docs", pattern: /(^|\/)(docs\/|README(\.[^/]+)?$|CHANGELOG(\.[^/]+)?$|LICENSE(\.[^/]+)?$|.*\.mdx?$)/i, severity: null },
  { domain: "tests", pattern: /(^|\/)(tests?|__tests__|__fixtures__|fixtures)(\/|$)|\.(test|spec)\.[tj]sx?$/i, severity: null },
  { domain: "ui", pattern: /(^|\/)(src\/)?(components|ui|styles|themes)(\/|$)|\.css$/i, severity: null },
  { domain: "staging_only", pattern: /(^|\/)(staging|smoke|demo)(\/|$)|README smoke/i, severity: null },
  { domain: "api_logic", pattern: /(^|\/)(src\/)?app\/api(\/|$)|(^|\/)(src\/)?routes?(\/|$)/i, severity: null },
  { domain: "integration_glue", pattern: /(^|\/)(src\/)?(integrations?|adapters?|clients?)(\/|$)/i, severity: null },
  { domain: "auth_security", pattern: /(^|\/)(src\/)?(auth|security|session|csrf|rbac|acl|oauth|sso|middleware)(\/|$)|login|permission/i, severity: "high" },
  { domain: "billing_pricing", pattern: /(^|\/)(src\/)?(billing|pricing|prices?|subscriptions?|invoices?)(\/|$)|stripe|payment/i, severity: "high" },
  { domain: "database_migration", pattern: /(^|\/)(db|database|schema|migrations?|prisma)(\/|$)|\.sql$/i, severity: "high" },
  { domain: "deployment_env", pattern: /(^|\/)(deploy|deployment|docker|k8s|helm|terraform|env)(\/|$)|render|workflow/i, severity: "high" },
  { domain: "governance_release", pattern: /(^|\/)(governance|audit|policy|review-stages|approval|release-gates?|release-signoff|deployment-gates?)(\/|$)/i, severity: "high" },
  { domain: "tenant_isolation", pattern: /tenant|multi-tenant|workspace[-_ ]boundary|isolation/i, severity: "critical" },
  { domain: "external_provider", pattern: /(^|\/)(providers?|integrations?)(\/|$)|github|gitlab|render|stripe|slack|twilio/i, severity: "high" },
  { domain: "credential_handling", pattern: /(^|\/)\.env(\.|$)|secret|credentials?|private[-_]?key|api[-_]?key|token/i, severity: "critical" },
  { domain: "payment_execution", pattern: /charge|capture|refund|payout|payment[-_ ]intent|checkout-session/i, severity: "critical" },
  { domain: "permission_escalation", pattern: /grant|elevat(e|ion)|role(s)?|privilege|sudo|admin[-_ ]only/i, severity: "critical" },
  { domain: "production_data", pattern: /prod(uction)?[-_/ ]data|customer[-_/ ]data|live[-_/ ]data/i, severity: "critical" },
  { domain: "app_logic", pattern: /(^|\/)(src|lib|server|app)(\/|$)/i, severity: null },
];

export function normalizeIntelligencePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function classifyPathDomains(filePath: string): Set<IntelligencePathDomain> {
  const normalized = normalizeIntelligencePath(filePath);
  const domains = new Set<IntelligencePathDomain>();
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(normalized)) {
      domains.add(rule.domain);
    }
  }
  if (domains.size === 0) {
    domains.add("app_logic");
  }
  return domains;
}

export function maxSeverityForDomains(domains: Iterable<IntelligencePathDomain>): DangerPointSeverity {
  const order: DangerPointSeverity[] = ["info", "low", "medium", "high", "critical"];
  let current: DangerPointSeverity = "info";
  for (const domain of domains) {
    const rule = DOMAIN_RULES.find((entry) => entry.domain === domain);
    const severity = rule?.severity ?? null;
    if (!severity) continue;
    if (order.indexOf(severity) > order.indexOf(current)) {
      current = severity;
    }
  }
  return current;
}

export function inferTaskIntent(taskTitle: string, taskDescription: string): TaskIntentSummary {
  const normalizedText = `${taskTitle} ${taskDescription}`.toLowerCase();
  const intents = new Set<TaskIntentSummary["intents"] extends Set<infer T> ? T : never>();

  if (/\b(readme|docs?|documentation|guide|glossary|audit)\b/i.test(normalizedText)) {
    intents.add("docs");
  }
  if (/\b(test|tests|spec|fixture|smoke)\b/i.test(normalizedText)) {
    intents.add("tests");
  }
  if (/\b(ui|ux|copy|component|display|layout|button|screen|page)\b/i.test(normalizedText)) {
    intents.add("ui");
  }
  if (/\b(pr|pull request|merge|release|checklist|sign-?off)\b/i.test(normalizedText)) {
    intents.add("release");
  }
  if (/\b(deploy|deployment|health check|health policy|staging)\b/i.test(normalizedText)) {
    intents.add("deployment");
  }
  if (/\b(auth|session|security|login|permission|role)\b/i.test(normalizedText)) {
    intents.add("auth");
  }
  if (/\b(billing|pricing|price|payment|invoice|subscription|stripe)\b/i.test(normalizedText)) {
    intents.add("billing");
  }
  if (/\b(db|database|schema|migration|sql)\b/i.test(normalizedText)) {
    intents.add("database");
  }
  if (/\b(staging|smoke|demo)\b/i.test(normalizedText)) {
    intents.add("staging");
  }

  const explicitPaths = Array.from(
    new Set(
      Array.from(
        normalizedText.matchAll(/\b(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|md|mdx|sql|yml|yaml)\b/g),
      ).map((match) => normalizeIntelligencePath(match[0])),
    ),
  );

  return { intents, explicitPaths, normalizedText };
}

export function tokenizeForComparison(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

export function summarizeChangedFileRisk(args: {
  changedFiles: string[];
  createdFiles: string[];
  operationTypes: string[];
}): ChangedFileRiskSummary {
  const normalized = args.changedFiles.map(normalizeIntelligencePath).filter(Boolean);
  const domainCounts: Partial<Record<IntelligencePathDomain, number>> = {};
  const highRiskPaths: string[] = [];
  const criticalRiskPaths: string[] = [];

  for (const file of normalized) {
    const domains = classifyPathDomains(file);
    for (const domain of domains) {
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    }
    const severity = maxSeverityForDomains(domains);
    if (severity === "critical") {
      criticalRiskPaths.push(file);
    } else if (severity === "high") {
      highRiskPaths.push(file);
    }
  }

  const docsOnly = normalized.length > 0 && normalized.every((file) => classifyPathDomains(file).has("docs"));
  const testOnly = normalized.length > 0 && normalized.every((file) => classifyPathDomains(file).has("tests"));
  const uiDisplayOnly =
    normalized.length > 0 &&
    normalized.every((file) => {
      const domains = classifyPathDomains(file);
      return domains.has("ui") && !domains.has("auth_security") && !domains.has("billing_pricing");
    });
  const stagingOnly = normalized.length > 0 && normalized.every((file) => classifyPathDomains(file).has("staging_only"));
  const reversibleSimpleFileCreation =
    normalized.length > 0 &&
    normalized.every((file) => args.createdFiles.includes(file)) &&
    args.operationTypes.every((type) => type === "create_file") &&
    !highRiskPaths.length &&
    !criticalRiskPaths.length;

  let summary = `${normalized.length} changed file${normalized.length === 1 ? "" : "s"}.`;
  if (docsOnly) {
    summary = `${normalized.length} docs-only file${normalized.length === 1 ? "" : "s"}.`;
  } else if (testOnly) {
    summary = `${normalized.length} test-only file${normalized.length === 1 ? "" : "s"}.`;
  } else if (uiDisplayOnly) {
    summary = `${normalized.length} UI-focused file${normalized.length === 1 ? "" : "s"} with no high-risk domains detected.`;
  } else if (stagingOnly) {
    summary = `${normalized.length} staging-only file${normalized.length === 1 ? "" : "s"}.`;
  } else if (criticalRiskPaths.length > 0) {
    summary = `${criticalRiskPaths.length} critical-risk path${criticalRiskPaths.length === 1 ? "" : "s"} detected.`;
  } else if (highRiskPaths.length > 0) {
    summary = `${highRiskPaths.length} high-risk path${highRiskPaths.length === 1 ? "" : "s"} detected.`;
  }

  return {
    totalFiles: normalized.length,
    docsOnly,
    testOnly,
    uiDisplayOnly,
    stagingOnly,
    reversibleSimpleFileCreation,
    domainCounts,
    highRiskPaths,
    criticalRiskPaths,
    summary,
  };
}
