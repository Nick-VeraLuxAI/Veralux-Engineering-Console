import { describe, expect, it, vi } from "vitest";
import {
  approvalReviewRuntimePolicyHandoffFixture,
  fallbackRequiredRuntimePolicyHandoffFixture,
  rejectedMutationRuntimePolicyHandoffFixture,
  secretBearingRuntimePolicyHandoffFixture,
  validPlanningRuntimePolicyHandoffFixture,
} from "./vera-runtime-policy-handoff.fixtures";
import { validateVeraRuntimePolicyHandoff } from "./vera-runtime-policy-handoff-contract";

function invalidWith(overrides: Record<string, unknown>) {
  return {
    ...validPlanningRuntimePolicyHandoffFixture,
    ...overrides,
  };
}

describe("Vera runtime policy handoff Console contract", () => {
  it("accepts valid System handoff metadata as metadata-only", () => {
    const result = validateVeraRuntimePolicyHandoff(validPlanningRuntimePolicyHandoffFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid handoff");
    expect(result.handoff).toMatchObject({
      runtime_policy_version: "vera_runtime_model_policy_v1.0",
      requested_task_class: "planning",
      selected_runtime_role: "command",
      selected_runtime_ref: "runtime-ref-command-local",
    });
    expect(result.metadata_only).toBe(true);
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_model_call).toBe(false);
    expect(result.authorizes_provider_call).toBe(false);
    expect(result.authorizes_runtime_startup).toBe(false);
    expect(result.authorizes_console_mutation).toBe(false);
  });

  it("rejects missing policy version, task class, and runtime role", () => {
    const missingPolicy = validateVeraRuntimePolicyHandoff(
      invalidWith({ runtime_policy_version: undefined }),
    );
    const missingTask = validateVeraRuntimePolicyHandoff(
      invalidWith({ requested_task_class: undefined }),
    );
    const missingRole = validateVeraRuntimePolicyHandoff(
      invalidWith({ selected_runtime_role: undefined }),
    );

    expect(missingPolicy.ok).toBe(false);
    expect(!missingPolicy.ok && missingPolicy.errors[0].field).toBe("runtime_policy_version");
    expect(missingTask.ok).toBe(false);
    expect(!missingTask.ok && missingTask.errors[0].field).toBe("requested_task_class");
    expect(missingRole.ok).toBe(false);
    expect(!missingRole.ok && missingRole.errors[0].field).toBe("selected_runtime_role");
  });

  it("rejects unknown task class, runtime role, capability, binding, fallback, and decision", () => {
    const result = validateVeraRuntimePolicyHandoff(
      invalidWith({
        requested_task_class: "deploy",
        selected_runtime_role: "superuser",
        required_capabilities: ["reasoning", "shell"],
        provider_binding_state: "provider_ready",
        fallback_state: "implicit",
        decision: "execute",
      }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "unsupported_task_class",
        "unsupported_runtime_role",
        "unsupported_capability",
        "unsupported_binding_state",
        "unsupported_fallback_state",
        "unsupported_decision",
      ]),
    );
  });

  it("treats provider and model refs as metadata only", () => {
    const result = validateVeraRuntimePolicyHandoff(
      invalidWith({
        selected_runtime_ref: "cloud-anthropic-claude-candidate",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected metadata-only provider ref");
    expect(result.handoff.selected_runtime_ref).toBe("cloud-anthropic-claude-candidate");
    expect(result.handoff.non_authorizing_context.model_or_provider_ref_is_authority).toBe(false);
    expect(result.authorizes_execution).toBe(false);
  });

  it("rejects provider/model refs as authority or hard requirements", () => {
    const contextAuthority = validateVeraRuntimePolicyHandoff(
      invalidWith({
        non_authorizing_context: {
          ...validPlanningRuntimePolicyHandoffFixture.non_authorizing_context,
          model_or_provider_ref_is_authority: true,
        },
      }),
    );
    const modelRequirement = validateVeraRuntimePolicyHandoff(
      invalidWith({ required_model: "gpt-candidate" }),
    );

    expect(contextAuthority.ok).toBe(false);
    expect(!contextAuthority.ok && contextAuthority.errors[0].code).toBe(
      "model_provider_authority_rejected",
    );
    expect(modelRequirement.ok).toBe(false);
    expect(!modelRequirement.ok && modelRequirement.errors[0].code).toBe(
      "model_provider_authority_rejected",
    );
  });

  it("allows selected runtime ref to be null only when fallback is explicit and audited", () => {
    const result = validateVeraRuntimePolicyHandoff(fallbackRequiredRuntimePolicyHandoffFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected fallback handoff");
    expect(result.handoff.selected_runtime_ref).toBeNull();
    expect(result.handoff.fallback_state).toBe("required");
    expect(result.handoff.audit_required).toBe(true);
  });

  it("rejects fallback-required handoffs that are not audited", () => {
    const result = validateVeraRuntimePolicyHandoff(
      invalidWith({
        ...fallbackRequiredRuntimePolicyHandoffFixture,
        audit_required: false,
      }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "audit_required")).toBe(true);
  });

  it("rejects secrets, provider credentials, and raw secret-like metadata", () => {
    const secret = validateVeraRuntimePolicyHandoff(secretBearingRuntimePolicyHandoffFixture);
    const credential = validateVeraRuntimePolicyHandoff(
      invalidWith({ provider_credentials: { token: "bearer abc.def" } }),
    );
    const rawSecret = validateVeraRuntimePolicyHandoff(
      invalidWith({ metadata: { raw_value: "-----BEGIN PRIVATE KEY-----" } }),
    );

    expect(secret.ok).toBe(false);
    expect(credential.ok).toBe(false);
    expect(rawSecret.ok).toBe(false);
    expect(!secret.ok && secret.errors[0].code).toBe("unsafe_metadata");
  });

  it("rejects mutation and final integration mutation authority", () => {
    const capability = validateVeraRuntimePolicyHandoff(rejectedMutationRuntimePolicyHandoffFixture);
    const context = validateVeraRuntimePolicyHandoff(
      invalidWith({
        non_authorizing_context: {
          ...validPlanningRuntimePolicyHandoffFixture.non_authorizing_context,
          authorizes_console_mutation: true,
        },
      }),
    );

    expect(capability.ok).toBe(false);
    expect(!capability.ok && capability.errors[0].code).toBe("mutation_authority_rejected");
    expect(context.ok).toBe(false);
    expect(!context.ok && context.errors[0].code).toBe("mutation_authority_rejected");
  });

  it("preserves RBAC deferral for approval review", () => {
    const result = validateVeraRuntimePolicyHandoff(approvalReviewRuntimePolicyHandoffFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected approval handoff");
    expect(result.handoff.decision).toBe("requires_operator_review");
    expect(result.handoff.non_authorizing_context.requires_rbac_for_approval).toBe(true);
    expect(result.handoff.non_authorizing_context.authorizes_approval).toBe(false);
  });

  it("does not call providers, runtimes, filesystem, Git, PR, or Console mutation hooks", () => {
    const providerCall = vi.fn();
    const runtimeStartup = vi.fn();
    const mutation = vi.fn();

    const result = validateVeraRuntimePolicyHandoff(validPlanningRuntimePolicyHandoffFixture);

    expect(result.ok).toBe(true);
    expect(providerCall).not.toHaveBeenCalled();
    expect(runtimeStartup).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(result.authorizes_git_pr_mutation).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });
});
