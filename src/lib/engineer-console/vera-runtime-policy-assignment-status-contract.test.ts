import { describe, expect, it, vi } from "vitest";
import {
  blockedAssignmentStatusResponseFixture,
  disabledAssignmentStatusResponseFixture,
  fallbackRequiredAssignmentStatusResponseFixture,
  invalidAssignmentStatusResponseFixture,
  invalidRequestAssignmentStatusResponseFixture,
  missingConfigAssignmentStatusResponseFixture,
  mutationAuthorityAssignmentStatusResponseFixture,
  notFoundAssignmentStatusResponseFixture,
  requiresOperatorReviewAssignmentStatusResponseFixture,
  secretBearingAssignmentStatusResponseFixture,
  storageErrorAssignmentStatusResponseFixture,
  storageRootLeakAssignmentStatusResponseFixture,
  validRequestAssignmentListStatusResponseFixture,
  validSingleAssignmentStatusResponseFixture,
} from "./vera-runtime-policy-assignment-status.fixtures";
import { validateVeraRuntimePolicyAssignmentStatusResponse } from "./vera-runtime-policy-assignment-status-contract";

function invalidWith(overrides: Record<string, unknown>) {
  return {
    ...validSingleAssignmentStatusResponseFixture,
    ...overrides,
  };
}

describe("Vera runtime policy assignment status Console contract", () => {
  it("accepts a valid single assignment status response as metadata-only", () => {
    const result = validateVeraRuntimePolicyAssignmentStatusResponse(
      validSingleAssignmentStatusResponseFixture,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid assignment status");
    expect(result.response.assignment_status).toMatchObject({
      assignment_id: "runtime-assignment-1",
      request_id: "runtime-request-1",
      task_class: "planning",
      runtime_role: "command",
      selected_runtime_ref: "runtime-ref-command-local",
    });
    expect(result.metadata_only).toBe(true);
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_model_call).toBe(false);
    expect(result.authorizes_provider_call).toBe(false);
    expect(result.authorizes_runtime_startup).toBe(false);
    expect(result.authorizes_console_mutation).toBe(false);
  });

  it("accepts a valid request assignment list response", () => {
    const result = validateVeraRuntimePolicyAssignmentStatusResponse(
      validRequestAssignmentListStatusResponseFixture,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid assignment list");
    expect(result.response.lookup_mode).toBe("request_id");
    expect(result.response.assignments).toHaveLength(2);
  });

  it("accepts safe non-actionable route states", () => {
    for (const fixture of [
      disabledAssignmentStatusResponseFixture,
      missingConfigAssignmentStatusResponseFixture,
      notFoundAssignmentStatusResponseFixture,
      invalidRequestAssignmentStatusResponseFixture,
      storageErrorAssignmentStatusResponseFixture,
    ]) {
      const result = validateVeraRuntimePolicyAssignmentStatusResponse(fixture);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected safe status response");
      expect(result.response.ok).toBe(false);
      expect(result.response.actions_available_from_ui).toBe(false);
      expect(result.authorizes_execution).toBe(false);
    }
  });

  it("accepts fallback, blocked, operator-review, and invalid assignment statuses as metadata", () => {
    for (const fixture of [
      fallbackRequiredAssignmentStatusResponseFixture,
      blockedAssignmentStatusResponseFixture,
      requiresOperatorReviewAssignmentStatusResponseFixture,
      invalidAssignmentStatusResponseFixture,
    ]) {
      const result = validateVeraRuntimePolicyAssignmentStatusResponse(fixture);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected metadata assignment status");
      expect(result.response.assignment_status?.audit_required).toBe(true);
      expect(result.response.runtime_execution_allowed).toBe(false);
    }
  });

  it("rejects responses that are not explicitly read-only or expose UI actions", () => {
    const notReadOnly = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ read_only: false }),
    );
    const actionable = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ actions_available_from_ui: true }),
    );

    expect(notReadOnly.ok).toBe(false);
    expect(actionable.ok).toBe(false);
    expect(!actionable.ok && actionable.errors[0].code).toBe("mutation_authority_rejected");
  });

  it("rejects execution, provider, runtime startup, mutation, and final integration authority", () => {
    const execution = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ runtime_execution_allowed: true }),
    );
    const provider = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ provider_calls_allowed: true }),
    );
    const startup = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ runtime_startup_allowed: true }),
    );
    const mutation = validateVeraRuntimePolicyAssignmentStatusResponse(
      mutationAuthorityAssignmentStatusResponseFixture,
    );
    const finalIntegration = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ final_integration_allowed: true }),
    );

    expect(execution.ok).toBe(false);
    expect(provider.ok).toBe(false);
    expect(startup.ok).toBe(false);
    expect(mutation.ok).toBe(false);
    expect(finalIntegration.ok).toBe(false);
  });

  it("rejects provider credentials, secrets, raw model config, storage paths, and commands", () => {
    const secret = validateVeraRuntimePolicyAssignmentStatusResponse(
      secretBearingAssignmentStatusResponseFixture,
    );
    const credential = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ provider_credentials: { token: "bearer abc.def" } }),
    );
    const rawModelConfig = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ raw_model_config: { model: "hard-required" } }),
    );
    const storagePath = validateVeraRuntimePolicyAssignmentStatusResponse(
      storageRootLeakAssignmentStatusResponseFixture,
    );
    const command = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({ startup_command: "python run_provider.py" }),
    );

    expect(secret.ok).toBe(false);
    expect(credential.ok).toBe(false);
    expect(rawModelConfig.ok).toBe(false);
    expect(storagePath.ok).toBe(false);
    expect(command.ok).toBe(false);
  });

  it("treats selected and fallback runtime refs as metadata only", () => {
    const result = validateVeraRuntimePolicyAssignmentStatusResponse(
      invalidWith({
        assignment_status: {
          ...validSingleAssignmentStatusResponseFixture.assignment_status,
          selected_runtime_ref: "cloud-provider-runtime-ref",
          fallback_runtime_ref: "fallback-runtime-ref",
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected metadata-only runtime refs");
    expect(result.response.assignment_status?.selected_runtime_ref).toBe("cloud-provider-runtime-ref");
    expect(result.authorizes_provider_call).toBe(false);
    expect(result.authorizes_execution).toBe(false);
  });

  it("returns stable metadata-only validation output", () => {
    const result = validateVeraRuntimePolicyAssignmentStatusResponse(
      validSingleAssignmentStatusResponseFixture,
    );

    expect(result).toMatchObject({
      ok: true,
      validation_state: "metadata_valid",
      metadata_only: true,
      authorizes_execution: false,
      authorizes_model_call: false,
      authorizes_provider_call: false,
      authorizes_runtime_startup: false,
      authorizes_console_mutation: false,
      authorizes_main_tree_mutation: false,
      authorizes_git_pr_mutation: false,
      authorizes_final_integration: false,
    });
  });

  it("does not call System, network, model, provider, runtime, Git, PR, or Console mutation hooks", () => {
    const systemApi = vi.fn();
    const network = vi.fn();
    const modelCall = vi.fn();
    const providerCall = vi.fn();
    const runtimeStartup = vi.fn();
    const mutation = vi.fn();

    const result = validateVeraRuntimePolicyAssignmentStatusResponse(
      validSingleAssignmentStatusResponseFixture,
    );

    expect(result.ok).toBe(true);
    expect(systemApi).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(modelCall).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
    expect(runtimeStartup).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });
});
