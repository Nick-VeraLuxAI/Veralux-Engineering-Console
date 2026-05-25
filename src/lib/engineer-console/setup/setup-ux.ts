export type SetupReadinessStatus = "ready" | "warning" | "missing" | "not_checked";

export interface SetupReadinessItem {
  id: string;
  title: string;
  status: SetupReadinessStatus;
  detail: string;
  nextAction?: string;
}

export interface SetupReadinessSignals {
  authEnabled: boolean;
  trustedLocalDev: boolean;
  releaseGatesEnabled: boolean;
  auditChainScope: string;
  auditChainUsesDefault: boolean;
  repoRoots: string[];
  backupAlertMode: "none" | "webhook";
  registeredRepoCount: number;
  verifiedRepoCount: number;
  fileIndexedRepoCount: number;
  codeIndexedRepoCount: number;
  compatibilityStatus: "missing" | "completed" | "failed";
}

export interface SetupReadinessSummary {
  items: SetupReadinessItem[];
}

export interface StagingTaskPreset {
  title: string;
  description: string;
  priority: "normal";
}

export interface StagingWorkflowStep {
  id: string;
  title: string;
  detail: string;
  href?: string;
}

export interface RepoPathGuidance {
  status: "ready" | "warning" | "info";
  message: string;
}

export interface RepoStatusSummary {
  labels: string[];
  nextAction: string;
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function deriveSetupReadinessItems(signals: SetupReadinessSignals): SetupReadinessItem[] {
  const items: SetupReadinessItem[] = [];

  items.push({
    id: "auth",
    title: "Authentication",
    status: signals.authEnabled ? "ready" : "warning",
    detail: signals.authEnabled
      ? "Authentication is enabled."
      : "Authentication is disabled for trusted local development.",
    nextAction: signals.authEnabled ? undefined : "Enable auth before staging or production use.",
  });

  items.push({
    id: "trusted-local",
    title: "Trusted local development",
    status: signals.trustedLocalDev ? "warning" : "ready",
    detail: signals.trustedLocalDev
      ? "Trusted local development is enabled in this environment."
      : "Trusted local development is disabled.",
    nextAction: signals.trustedLocalDev ? "Disable trusted local development before staging or production." : undefined,
  });

  items.push({
    id: "release-gates",
    title: "Hard release gates",
    status: signals.releaseGatesEnabled ? "ready" : "warning",
    detail: signals.releaseGatesEnabled
      ? "Release gates are enabled."
      : "Release gates are disabled, so release controls stay advisory.",
    nextAction: signals.releaseGatesEnabled ? undefined : "Enable release gates for staging or production dry runs.",
  });

  items.push({
    id: "audit-scope",
    title: "Audit chain scope",
    status: signals.auditChainUsesDefault ? "warning" : "ready",
    detail: signals.auditChainUsesDefault
      ? `Audit chain scope is using the default value (${signals.auditChainScope}).`
      : `Audit chain scope is configured as ${signals.auditChainScope}.`,
    nextAction: signals.auditChainUsesDefault ? "Set a unique scope for staging or production to isolate audit chains." : undefined,
  });

  items.push({
    id: "repo-roots",
    title: "Approved repo roots",
    status: signals.repoRoots.length > 0 ? "ready" : "warning",
    detail: signals.repoRoots.length > 0
      ? `Repo roots are configured (${signals.repoRoots.length}).`
      : "Approved repo roots are not configured in this environment.",
    nextAction: signals.repoRoots.length > 0 ? undefined : "Set ENGINEER_CONSOLE_REPO_ROOTS before staging or production repo registration.",
  });

  items.push({
    id: "backup-alert",
    title: "Backup alert mode",
    status: signals.backupAlertMode === "webhook" ? "warning" : "warning",
    detail: signals.backupAlertMode === "webhook"
      ? "Backup alert mode is webhook, but webhook delivery must be tested manually."
      : "Backup alert mode is none.",
    nextAction: signals.backupAlertMode === "webhook"
      ? "Run a manual alert drill before production sign-off."
      : "Set webhook alert mode for staging or production backup monitoring.",
  });

  items.push({
    id: "registered-repos",
    title: "Registered repositories",
    status: signals.registeredRepoCount > 0 ? "ready" : "missing",
    detail: signals.registeredRepoCount > 0
      ? `${signals.registeredRepoCount} registered repos available.`
      : "No repositories are registered yet.",
    nextAction: signals.registeredRepoCount > 0 ? undefined : "Register a repo first.",
  });

  items.push({
    id: "verified-repo",
    title: "Verified repository",
    status: signals.verifiedRepoCount > 0 ? "ready" : "missing",
    detail: signals.verifiedRepoCount > 0
      ? `${signals.verifiedRepoCount} registered repos have been verified.`
      : "No registered repo has been verified yet.",
    nextAction: signals.verifiedRepoCount > 0 ? undefined : "Verify at least one registered repo before indexing or creating a smoke task.",
  });

  items.push({
    id: "file-index",
    title: "File index",
    status: signals.fileIndexedRepoCount > 0 ? "ready" : "missing",
    detail: signals.fileIndexedRepoCount > 0
      ? `File index exists for ${signals.fileIndexedRepoCount} repos.`
      : "File index has not been run yet.",
    nextAction: signals.fileIndexedRepoCount > 0 ? undefined : "Run file index after repo verification.",
  });

  items.push({
    id: "code-index",
    title: "Code index",
    status: signals.codeIndexedRepoCount > 0 ? "ready" : "missing",
    detail: signals.codeIndexedRepoCount > 0
      ? `Code index exists for ${signals.codeIndexedRepoCount} repos.`
      : "Code index has not been run yet.",
    nextAction: signals.codeIndexedRepoCount > 0 ? undefined : "Run code index after file index.",
  });

  items.push({
    id: "compatibility",
    title: "Compatibility analysis",
    status:
      signals.compatibilityStatus === "completed"
        ? "ready"
        : signals.compatibilityStatus === "failed"
          ? "warning"
          : "missing",
    detail:
      signals.compatibilityStatus === "completed"
        ? "Compatibility analysis results are available."
        : signals.compatibilityStatus === "failed"
          ? "The latest compatibility analysis failed."
          : "Compatibility analysis has not been run yet.",
    nextAction:
      signals.compatibilityStatus === "completed"
        ? undefined
        : "Run code index, then compatibility analysis.",
  });

  items.push({
    id: "verify-ci",
    title: "Latest verify:ci result",
    status: "not_checked",
    detail: "This is not tracked in the UI yet.",
    nextAction: "Track verify:ci manually in CI or the staging checklist before sign-off.",
  });

  items.push({
    id: "backup-verify",
    title: "Latest backup verification",
    status: "not_checked",
    detail: "This is not tracked in the UI yet.",
    nextAction: "Track backup verification manually with backup:db:verify and the staging checklist.",
  });

  return items;
}

export function buildSetupReadinessSummary(signals: SetupReadinessSignals): SetupReadinessSummary {
  return { items: deriveSetupReadinessItems(signals) };
}

export function shouldShowStagingSetupHelper(input: {
  auditChainScope?: string | null;
  nodeEnv?: string | null;
  trustedLocalDev?: boolean;
}): boolean {
  const auditScope = input.auditChainScope?.trim().toLowerCase() ?? "";
  const nodeEnv = input.nodeEnv?.trim().toLowerCase() ?? "";

  if (auditScope.includes("staging")) return true;
  if (nodeEnv === "development" || nodeEnv === "test") return true;
  return Boolean(input.trustedLocalDev);
}

export function buildStagingTaskPreset(): StagingTaskPreset {
  return {
    title: "Create README staging verification note",
    description:
      "Add a README.md file that says this repository was used to verify the VeraLux Engineering Console staging workflow. Keep the change small and safe.",
    priority: "normal",
  };
}

export function buildSmokeRepoExamplePath(repoRoots: string[]): string {
  if (repoRoots.length > 0) {
    return `${normalizePathLike(repoRoots[0])}/smoke-repo`;
  }
  return "/path/to/staging/smoke-repo";
}

export function buildStagingSmokeWorkflowSteps(): StagingWorkflowStep[] {
  return [
    {
      id: "register-repo",
      title: "Register smoke repo",
      detail: "Register the smoke repository from the approved repo roots list.",
      href: "/engineer/repos",
    },
    {
      id: "verify-repo",
      title: "Verify repo path",
      detail: "Confirm the repo path is allowed and the repository verifies cleanly.",
      href: "/engineer/repos",
    },
    {
      id: "index-files",
      title: "Index files",
      detail: "Build file metadata before code index or compatibility analysis.",
      href: "/engineer/repos",
    },
    {
      id: "index-code",
      title: "Index code",
      detail: "Build symbols and chunks after the file index is complete.",
      href: "/engineer/repos",
    },
    {
      id: "compatibility",
      title: "Run compatibility analysis",
      detail: "Record cross-repo surfaces and links before broader staging review.",
      href: "/engineer/compatibility",
    },
    {
      id: "create-task",
      title: "Create README smoke task",
      detail: "Use the staging README preset when it appears in the task form.",
      href: "/engineer",
    },
    {
      id: "start-run",
      title: "Start run",
      detail: "Create the run from the new task, then move into the guided run page workflow.",
      href: "/engineer",
    },
    {
      id: "worker-plan",
      title: "Use README smoke worker plan",
      detail: "Use the existing README smoke helper in the worker-plan builder.",
    },
    {
      id: "approval",
      title: "Approve and review",
      detail: "Use the Current Action zone, review panels, and approval controls to complete governance work.",
    },
    {
      id: "pr",
      title: "Create or retry draft PR",
      detail: "Use the PR state card to confirm commit reuse, branch state, and next action.",
    },
    {
      id: "record-result",
      title: "Record staging result",
      detail: "Update the staging checklist and report with the final PASS or FAIL result.",
    },
  ];
}

export function deriveRepoPathGuidance(input: {
  inputPath: string;
  allowedRoots: string[];
}): RepoPathGuidance {
  if (input.allowedRoots.length === 0) {
    return {
      status: "info",
      message:
        "Approved repo roots are not configured here. Any local path may be registered in this environment, but staging and production should set approved roots first.",
    };
  }

  if (!input.inputPath.trim()) {
    return {
      status: "info",
      message: "Enter an absolute path inside an approved repo root. Path must be inside approved repo roots.",
    };
  }

  const normalizedPath = normalizePathLike(input.inputPath.trim());
  const normalizedRoots = input.allowedRoots.map(normalizePathLike);
  const matches = normalizedRoots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`),
  );

  return matches
    ? {
        status: "ready",
        message: "Path is inside an approved repo root.",
      }
    : {
        status: "warning",
        message: "Path must be inside approved repo roots.",
      };
}

export function formatRepoRegistrationErrorMessage(error: string): string {
  if (/ENGINEER_CONSOLE_REPO_ROOTS allowlist/i.test(error)) {
    return "Path must be inside approved repo roots.";
  }
  return error;
}

export function deriveRepoStatusSummary(input: {
  verificationStatus: string;
  fileCount: number;
  codeIndexReady: boolean;
  compatibilityAvailable: boolean;
}): RepoStatusSummary {
  const labels: string[] = [];

  if (input.verificationStatus === "ok") {
    labels.push("Repo verified");
  } else {
    labels.push("Repo needs verification");
  }

  if (input.fileCount > 0) {
    labels.push("File index complete");
  } else {
    labels.push("File index pending");
  }

  if (input.codeIndexReady) {
    labels.push("Code index complete");
  } else {
    labels.push("Code index pending");
  }

  if (input.compatibilityAvailable) {
    labels.push("Compatibility analysis available");
  }

  let nextAction = "Create a task after repo verification.";
  if (input.verificationStatus !== "ok") {
    nextAction = "Verify this repository first.";
  } else if (input.fileCount === 0) {
    nextAction = "Run file index before code index.";
  } else if (!input.codeIndexReady) {
    nextAction = "Run code index before compatibility analysis.";
  } else if (!input.compatibilityAvailable) {
    nextAction = "Run compatibility analysis.";
  }

  return { labels, nextAction };
}
