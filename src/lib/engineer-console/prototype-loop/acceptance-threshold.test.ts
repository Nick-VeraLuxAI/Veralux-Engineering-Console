import { describe, expect, it } from "vitest";
import {
  evaluateAcceptanceThreshold,
  type AcceptanceThresholdConfig,
} from "./acceptance-threshold";

function baseConfig(overrides: Partial<AcceptanceThresholdConfig> = {}): AcceptanceThresholdConfig {
  const taskId = "prototype-loop-v1-test";
  return {
    taskId,
    riskLevel: "low",
    prototypeWorkspacePath: `/tmp/repo/.prototype-loop/${taskId}`,
    requiredTestsConfigured: true,
    approvalRequired: true,
    integrationAllowed: false,
    integrationPerformed: false,
    evidenceBundleGenerated: true,
    filesCreatedOrChanged: [
      `.prototype-loop/${taskId}/word-count-cli.mjs`,
      `.prototype-loop/${taskId}/word-count-cli.test.mjs`,
    ],
    testResults: [{
      command: "node --test word-count-cli.test.mjs",
      status: "passed",
      exitCode: 0,
    }],
    lintTypecheckResults: [{
      command: "(not applicable)",
      status: "skipped",
      stderr: "Prototype workspace has no package-level lint/typecheck/build configuration.",
    }],
    diffScopeCheck: {
      status: "passed",
      unexpected_files: [],
      checked_files: [`.prototype-loop/${taskId}/word-count-cli.mjs`],
    },
    secretScanResult: {
      status: "passed",
      findings: [],
    },
    modelRoleRequirements: {
      vera: {
        role_id: "vera_command",
        repository_write_allowed: false,
        fallback_allowed: false,
      },
      console: {
        role_id: "console_default_worker",
        repository_write_allowed: true,
        fallback_allowed: false,
      },
      senior: {
        role_id: "console_senior_worker",
        status: "blocked_unproven",
        fallback_allowed: false,
      },
    },
    fallbackUsed: false,
    seniorUsed: false,
    preExistingUnrelatedFailures: [],
    ...overrides,
  };
}

describe("Acceptance Threshold Engine", () => {
  it("returns ready when all required gates pass", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig());

    expect(verdict.status).toBe("ready_for_user_approval");
    expect(verdict.ready).toBe(true);
    expect(verdict.failed_gates).toEqual([]);
    expect(verdict.blocked_gates).toEqual([]);
    expect(verdict.skipped_gates).toContain("optional_lint_typecheck_build");
  });

  it("returns not_ready when task-specific tests fail", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({
      testResults: [{ command: "node --test", status: "failed", exitCode: 1 }],
    }));

    expect(verdict.status).toBe("not_ready");
    expect(verdict.failed_gates).toContain("task_tests");
  });

  it("blocks when scope check fails", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({
      diffScopeCheck: { status: "failed", unexpected_files: ["src/app.ts"] },
    }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("scope_check");
  });

  it("blocks when secret scan fails", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({
      secretScanResult: { status: "failed", findings: ["secret_token=..."] },
    }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("secret_scan");
  });

  it("blocks when integration occurred before approval", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({ integrationPerformed: true }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("no_integration");
    expect(verdict.integration_performed).toBe(true);
  });

  it("blocks when evidence bundle is missing or malformed", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({ evidenceBundleGenerated: false }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("evidence_bundle");
    expect(verdict.evidence_bundle_ok).toBe(false);
  });

  it("blocks when approval is not required for prototype work", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({ approvalRequired: false }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("approval_required");
  });

  it("blocks when role policy is violated", () => {
    const config = baseConfig({
      modelRoleRequirements: {
        ...baseConfig().modelRoleRequirements,
        vera: { role_id: "vera_command", repository_write_allowed: true, fallback_allowed: false },
      },
    });

    const verdict = evaluateAcceptanceThreshold(config);

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("role_policy");
    expect(verdict.role_policy_ok).toBe(false);
  });

  it("blocks when a model fallback was used", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({ fallbackUsed: true }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("no_model_fallback");
  });

  it("blocks when senior or Super was used", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({ seniorUsed: true }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("senior_super_not_used");
  });

  it("records not-applicable optional gates with reasons", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig());

    expect(verdict.not_applicable_gates).toEqual([
      expect.objectContaining({
        name: "optional_lint_typecheck_build",
        status: "not_applicable",
        required: false,
      }),
    ]);
  });

  it("documents pre-existing unrelated failures without blocking scoped readiness", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({
      preExistingUnrelatedFailures: [{
        command: "npm run typecheck",
        summary: "Existing unrelated test fixture type errors outside prototype-loop files.",
      }],
    }));

    expect(verdict.status).toBe("ready_for_user_approval");
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.pre_existing_unrelated_failures[0].command).toBe("npm run typecheck");
  });

  it("blocks when prototype files leave .prototype-loop/<task-id>", () => {
    const verdict = evaluateAcceptanceThreshold(baseConfig({
      filesCreatedOrChanged: ["src/word-count-cli.mjs"],
    }));

    expect(verdict.status).toBe("blocked");
    expect(verdict.blocked_gates).toContain("prototype_workspace_scope");
  });
});
