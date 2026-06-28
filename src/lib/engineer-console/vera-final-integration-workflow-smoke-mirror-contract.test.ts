import { describe, expect, it, vi } from "vitest";
import {
  blockedFinalIntegrationWorkflowSmokeMirrorFixture,
  commandBearingFinalIntegrationWorkflowSmokeMirrorFixture,
  finalIntegrationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
  filesystemAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
  gitPrAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
  mutationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
  rawPatchFinalIntegrationWorkflowSmokeMirrorFixture,
  rejectedUnsafeFinalIntegrationWorkflowSmokeMirrorFixture,
  rollbackExecutionAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
  secretBearingFinalIntegrationWorkflowSmokeMirrorFixture,
  unrestrictedPathFinalIntegrationWorkflowSmokeMirrorFixture,
  validFinalIntegrationWorkflowSmokeMirrorFixture,
} from "./vera-final-integration-workflow-smoke-mirror.fixtures";
import { validateVeraFinalIntegrationWorkflowSmokeMirror } from "./vera-final-integration-workflow-smoke-mirror-contract";

function invalidWith(overrides: Record<string, unknown>) {
  return {
    ...validFinalIntegrationWorkflowSmokeMirrorFixture,
    ...overrides,
  };
}

describe("Vera final integration workflow smoke Console mirror contract", () => {
  it("accepts System-canonical final integration smoke metadata as Console mirror input only", () => {
    const result = validateVeraFinalIntegrationWorkflowSmokeMirror(
      validFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid final integration smoke mirror");
    expect(result.mirror).toMatchObject({
      canonical_owner: "Veralux-System",
      console_boundary: "mirror_validator_only",
      non_authoritative: true,
      current_final_integration_boundary: "manual_operator_v1",
      intended_future_vehicle: "github_pr_workflow",
    });
    expect(result.metadata_only).toBe(true);
    expect(result.authorizes_final_integration).toBe(false);
    expect(result.authorizes_git_pr_mutation).toBe(false);
    expect(result.authorizes_console_mutation).toBe(false);
  });

  it("accepts blocked/default-off metadata without granting dry-run or mutation authority", () => {
    const result = validateVeraFinalIntegrationWorkflowSmokeMirror(
      blockedFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected blocked metadata mirror");
    expect(result.mirror.integration_state).toBe("blocked-default-off");
    expect(result.mirror.dry_run_blocked_default_off_state).toBe("dry-run-default-off");
    expect(result.mirror.final_integration_blocked_default_off_state).toBe(
      "final-integration-default-off",
    );
    expect(result.authorizes_dry_run).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });

  it("keeps audit, rollback/abort, transport, dry-run readiness, workflow, and smoke ids cross-referenceable", () => {
    const result = validateVeraFinalIntegrationWorkflowSmokeMirror(
      validFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected cross-referenceable metadata");
    expect(result.mirror.audit_event_id).toBe("final-integration-audit-console-mirror-12i");
    expect(result.mirror.rollback_abort_event_id).toBe("rollback-abort-console-mirror-12i");
    expect(result.mirror.github_pr_transport_design_id).toBe("github-pr-transport-console-mirror-12i");
    expect(result.mirror.dry_run_readiness_id).toBe("dry-run-readiness-console-mirror-12i");
    expect(result.mirror.workflow_dry_run_contract_id).toBe("workflow-dry-run-console-mirror-12i");
    expect(result.mirror.vera_handoff_id).toBe("vera-handoff-console-mirror-12i");
    expect(result.mirror.candidate_id).toBe("candidate-console-mirror-12i");
    expect(result.mirror.runtime_policy_audit_id).toBe("runtime-policy-audit-console-mirror-12i");
  });

  it("rejects metadata that changes ownership, boundary, future vehicle, or default-off states", () => {
    const owner = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ canonical_owner: "Veralux-Engineering-Console" }),
    );
    const boundary = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ console_boundary: "executor" }),
    );
    const vehicle = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ intended_future_vehicle: "manual_operator_v1" }),
    );
    const activeIntegration = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ integration_state: "ready" }),
    );

    expect(owner.ok).toBe(false);
    expect(boundary.ok).toBe(false);
    expect(vehicle.ok).toBe(false);
    expect(activeIntegration.ok).toBe(false);
  });

  it("rejects mutation, dry-run, Git/PR, filesystem, rollback/abort, and final integration authority", () => {
    const dryRun = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ dry_run_execution_allowed: Boolean("unsafe") }),
    );
    const mutation = validateVeraFinalIntegrationWorkflowSmokeMirror(
      mutationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const gitPr = validateVeraFinalIntegrationWorkflowSmokeMirror(
      gitPrAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const filesystem = validateVeraFinalIntegrationWorkflowSmokeMirror(
      filesystemAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const rollback = validateVeraFinalIntegrationWorkflowSmokeMirror(
      rollbackExecutionAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const finalIntegration = validateVeraFinalIntegrationWorkflowSmokeMirror(
      finalIntegrationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const alternateFinalIntegration = validateVeraFinalIntegrationWorkflowSmokeMirror(
      invalidWith({ authorizes_final_integration: Boolean("unsafe") }),
    );

    expect(dryRun.ok).toBe(false);
    expect(mutation.ok).toBe(false);
    expect(gitPr.ok).toBe(false);
    expect(filesystem.ok).toBe(false);
    expect(rollback.ok).toBe(false);
    expect(finalIntegration.ok).toBe(false);
    expect(alternateFinalIntegration.ok).toBe(false);
  });

  it("rejects unsafe material instead of representing it as valid mirror metadata", () => {
    const rejected = validateVeraFinalIntegrationWorkflowSmokeMirror(
      rejectedUnsafeFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const secret = validateVeraFinalIntegrationWorkflowSmokeMirror(
      secretBearingFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const rawPatch = validateVeraFinalIntegrationWorkflowSmokeMirror(
      rawPatchFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const command = validateVeraFinalIntegrationWorkflowSmokeMirror(
      commandBearingFinalIntegrationWorkflowSmokeMirrorFixture,
    );
    const unrestrictedPath = validateVeraFinalIntegrationWorkflowSmokeMirror(
      unrestrictedPathFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(rejected.ok).toBe(false);
    expect(secret.ok).toBe(false);
    expect(rawPatch.ok).toBe(false);
    expect(command.ok).toBe(false);
    expect(unrestrictedPath.ok).toBe(false);
  });

  it("returns stable metadata-only validation output with all authority flags false", () => {
    const result = validateVeraFinalIntegrationWorkflowSmokeMirror(
      validFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(result).toMatchObject({
      ok: true,
      validation_state: "metadata_valid",
      metadata_only: true,
      authorizes_execution: false,
      authorizes_dry_run: false,
      authorizes_console_mutation: false,
      authorizes_main_tree_mutation: false,
      authorizes_git_pr_mutation: false,
      authorizes_filesystem_write: false,
      authorizes_rollback_execution: false,
      authorizes_abort_execution: false,
      authorizes_final_integration: false,
    });
  });

  it("does not call System, network, GitHub, Git, PR, route, model, provider, runtime, or mutation hooks", () => {
    const systemApi = vi.fn();
    const network = vi.fn();
    const githubClient = vi.fn();
    const gitClient = vi.fn();
    const prClient = vi.fn();
    const route = vi.fn();
    const modelCall = vi.fn();
    const providerCall = vi.fn();
    const runtimeStartup = vi.fn();
    const mutation = vi.fn();

    const result = validateVeraFinalIntegrationWorkflowSmokeMirror(
      validFinalIntegrationWorkflowSmokeMirrorFixture,
    );

    expect(result.ok).toBe(true);
    expect(systemApi).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(githubClient).not.toHaveBeenCalled();
    expect(gitClient).not.toHaveBeenCalled();
    expect(prClient).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(modelCall).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
    expect(runtimeStartup).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });
});
