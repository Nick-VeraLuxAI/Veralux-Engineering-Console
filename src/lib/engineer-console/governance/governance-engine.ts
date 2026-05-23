export interface GovernanceOptions {
  allowPackageLock?: boolean;
  allowMigrations?: boolean;
}

export interface GovernanceAssessment {
  riskLevel: "low" | "medium" | "high" | "blocked";
  issues: string[];
  blockedFiles: string[];
  canApprove: boolean;
}

const DEFAULT_PROTECTED_PATTERNS: Array<{ pattern: RegExp; label: string; severity: "blocked" | "high" }> = [
  { pattern: /^\.env$/, label: ".env", severity: "blocked" },
  { pattern: /^\.env\..+/, label: ".env.*", severity: "blocked" },
  { pattern: /^node_modules(\/|$)/, label: "node_modules", severity: "blocked" },
  { pattern: /^\.git(\/|$)/, label: ".git", severity: "blocked" },
  {
    pattern: /^package-lock\.json$/,
    label: "package-lock.json",
    severity: "high",
  },
  {
    pattern: /(^|\/)migrations(\/|$)/i,
    label: "migrations",
    severity: "high",
  },
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function assessChangedFiles(
  changedFiles: string[],
  options: GovernanceOptions = {},
): GovernanceAssessment {
  const issues: string[] = [];
  const blockedFiles: string[] = [];
  const order = ["low", "medium", "high", "blocked"] as const;
  let severityIndex = 0;

  const bump = (level: GovernanceAssessment["riskLevel"]) => {
    const nextIndex = order.indexOf(level);
    if (nextIndex > severityIndex) {
      severityIndex = nextIndex;
    }
  };

  for (const raw of changedFiles) {
    const file = normalizePath(raw);

    for (const rule of DEFAULT_PROTECTED_PATTERNS) {
      if (!rule.pattern.test(file)) continue;

      if (rule.label === "package-lock.json" && options.allowPackageLock) {
        continue;
      }
      if (rule.label === "migrations" && options.allowMigrations) {
        continue;
      }

      if (rule.severity === "blocked") {
        blockedFiles.push(file);
        issues.push(`Blocked change to protected path: ${file} (${rule.label})`);
        bump("blocked");
      } else {
        issues.push(`Risky change to protected path: ${file} (${rule.label})`);
        bump("high");
      }
    }
  }

  if (changedFiles.length > 20 && severityIndex === 0) {
    issues.push(`Large change set: ${changedFiles.length} files modified`);
    bump("medium");
  }

  const riskLevel = order[severityIndex];
  const canApprove = riskLevel !== "blocked";

  return {
    riskLevel,
    issues,
    blockedFiles,
    canApprove,
  };
}
