import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateTaskForm } from "@/components/engineer-console/create-task-form";
import { EngineerTaskList } from "@/components/engineer-console/engineer-task-list";
import { RegisteredReposPanel } from "@/components/engineer-console/registered-repos-panel";
import { SetupReadinessPanel } from "@/components/engineer-console/setup-readiness-panel";
import { getPublicSetupEnvironmentSummary } from "./build-setup-readiness-summary";
import {
  buildSetupReadinessSummary,
  buildStagingTaskPreset,
  deriveRepoPathGuidance,
  shouldShowStagingSetupHelper,
} from "./setup-ux";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) =>
    React.createElement("a", { href, className }, children),
}));

vi.mock("@/lib/engineer-console-client/fetch", () => ({
  engineerConsoleFetch: vi.fn(),
}));

describe("UX-6 setup guidance", () => {
  it("setup readiness panel renders with repo roots guidance", () => {
    const summary = buildSetupReadinessSummary({
      authEnabled: true,
      trustedLocalDev: false,
      releaseGatesEnabled: true,
      auditChainScope: "staging-west",
      auditChainUsesDefault: false,
      repoRoots: ["/srv/repos"],
      backupAlertMode: "webhook",
      registeredRepoCount: 1,
      verifiedRepoCount: 1,
      fileIndexedRepoCount: 1,
      codeIndexedRepoCount: 1,
      compatibilityStatus: "completed",
    });

    const html = renderToStaticMarkup(
      React.createElement(SetupReadinessPanel, { summary }),
    );

    expect(html).toContain("Setup readiness");
    expect(html).toContain("Repo roots are configured");
    expect(html).toContain("Secrets are never shown here");
  });

  it("public setup environment summary does not expose secrets", () => {
    const summary = getPublicSetupEnvironmentSummary({
      NODE_ENV: "production",
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "false",
      ENGINEER_CONSOLE_SESSION_SECRET: "super-secret-value",
      ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE: "staging-west",
      ENGINEER_CONSOLE_REPO_ROOTS: "/srv/repos",
      ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "webhook",
      ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL: "https://hooks.example.com/top-secret",
      ENGINEER_CONSOLE_RELEASE_GATES_ENABLED: "true",
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("https://hooks.example.com/top-secret");
    expect(serialized).toContain("staging-west");
  });

  it("repo path guidance explains when a path is outside approved roots", () => {
    const guidance = deriveRepoPathGuidance({
      inputPath: "/tmp/outside-repo",
      allowedRoots: ["/srv/repos"],
    });

    expect(guidance.status).toBe("warning");
    expect(guidance.message).toBe("Path must be inside approved repo roots.");
  });

  it("registered repos render approved root guidance and file-index-before-code-index hints", () => {
    const html = renderToStaticMarkup(
      React.createElement(RegisteredReposPanel, {
        initialRepos: [
          {
            id: "repo-1",
            name: "smoke-repo",
            path: "/srv/repos/smoke-repo",
            description: "Smoke repo",
            language: "ts",
            verificationStatus: "ok",
            verificationMessage: "Verified.",
            fileCount: 0,
            indexedAt: null,
            codeIndex: null,
            packageScripts: [],
            testProfile: null,
          },
        ],
        allowedRoots: ["/srv/repos"],
        compatibilityAvailable: false,
        smokeRepoExamplePath: "/srv/repos/smoke-repo",
      }),
    );

    expect(html).toContain("Approved repo roots");
    expect(html).toContain("Path must be inside approved repo roots.");
    expect(html).toContain("Run file index before code index.");
  });

  it("staging smoke helper logic appears in development or staging-like environments", () => {
    expect(
      shouldShowStagingSetupHelper({
        nodeEnv: "test",
        auditChainScope: "e2e-local",
        trustedLocalDev: true,
      }),
    ).toBe(true);

    expect(
      shouldShowStagingSetupHelper({
        nodeEnv: "production",
        auditChainScope: "production-west",
        trustedLocalDev: false,
      }),
    ).toBe(false);
  });

  it("create task form shows the staging preset only when enabled", () => {
    const preset = buildStagingTaskPreset();
    const enabledHtml = renderToStaticMarkup(
      React.createElement(CreateTaskForm, {
        onClose: vi.fn(),
        showStagingPreset: true,
        stagingTaskPreset: preset,
        registeredRepoCount: 1,
      }),
    );
    const disabledHtml = renderToStaticMarkup(
      React.createElement(CreateTaskForm, {
        onClose: vi.fn(),
        showStagingPreset: false,
        stagingTaskPreset: preset,
        registeredRepoCount: 1,
      }),
    );

    expect(enabledHtml).toContain("Staging helper preset");
    expect(enabledHtml).toContain("Use staging README preset");
    expect(disabledHtml).not.toContain("Staging helper preset");
  });

  it("dashboard empty state points operators to register a repo first", () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineerTaskList, {
        initialTasks: [],
        registeredRepoCount: 0,
        showStagingPreset: true,
        stagingTaskPreset: buildStagingTaskPreset(),
      }),
    );

    expect(html).toContain("Register a repo first");
    expect(html).toContain("Registered repositories");
    expect(html).toContain("Create task");
  });
});
