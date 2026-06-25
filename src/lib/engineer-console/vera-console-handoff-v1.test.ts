import { describe, expect, it } from "vitest";
import {
  VERA_CONSOLE_HANDOFF_V1_RUNTIME_POLICY_VERSION,
  VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION,
  validateVeraConsoleHandoffV1,
} from "./vera-console-handoff-v1";

function validHandoff(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION,
    request_id: "handoff-123",
    user_intent: "Build a governed prototype for a pricing summary export.",
    task_lane: "prototype_loop_v1",
    build_scope: {
      target_repo: "Veralux-System",
      allowed_paths: [".prototype-loop/<task-id>/", "evidence/prototype-loop-v1/<task-id>.json"],
      disallowed_paths: ["src/**", "public/**"],
      mutation_allowed: false,
    },
    acceptance_criteria: [
      "Prototype files are created only in an isolated workspace.",
      "Evidence is generated.",
    ],
    constraints: [
      "Do not mutate production files.",
      "Do not merge, deploy, push, commit, or open a PR.",
    ],
    risk_level: "low",
    evidence_refs: [
      {
        evidence_ref_id: "prototype-evidence-1",
        evidence_type: "prototype_loop",
        path_or_uri: "evidence/prototype-loop-v1/task-1.json",
        hash: "a".repeat(64),
        hash_algorithm: "sha256",
      },
    ],
    source_context_refs: [
      {
        source_context_id: "work-order-1",
        source_type: "vera_work_order",
        ref: "wo-123",
        description: "Source Vera work order.",
      },
    ],
    requested_role: "vera_build_router",
    runtime_policy_requirements: {
      requested_role: "vera_build_router",
      policy_version: VERA_CONSOLE_HANDOFF_V1_RUNTIME_POLICY_VERSION,
      enforcement_mode: "parity",
      risk_level: "low",
      privacy_level: "low",
      fallback_allowed: false,
      cloud_allowed: false,
      requires_audit_record: true,
      decision_audit_ref: "runtime-audit-1",
      compliance_note: "Metadata is structural only until downstream verification.",
    },
    approval_policy: {
      implementation_requires_approval: true,
      apply_requires_approval: true,
      integration_requires_approval: true,
      main_tree_mutation_allowed: false,
      approver_role_required: "operator",
    },
    created_at: "2026-06-25T15:00:00.000Z",
    ...overrides,
  };
}

function invalidFields(raw: unknown): string[] {
  const result = validateVeraConsoleHandoffV1(raw);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors.map((error) => error.field);
}

describe("vera_console_handoff_v1", () => {
  it("accepts a valid validation-only handoff", () => {
    const result = validateVeraConsoleHandoffV1(validHandoff());

    expect(result.ok).toBe(true);
    expect(result.evidence_claims_verified).toBe(false);
    expect(result.runtime_policy_metadata_verified).toBe(false);
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
    if (result.ok) {
      expect(result.handoff.schema_version).toBe(VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION);
      expect(result.handoff.evidence_refs[0]?.verification_state).toBe("claim_unverified");
      expect(result.handoff.runtime_policy_requirements.requested_role).toBe("vera_build_router");
    }
  });

  it("rejects missing required fields", () => {
    const fields = invalidFields({
      ...validHandoff(),
      request_id: "",
      acceptance_criteria: [],
    });

    expect(fields).toContain("request_id");
    expect(fields).toContain("acceptance_criteria");
  });

  it("rejects unsupported schema versions", () => {
    expect(invalidFields(validHandoff({ schema_version: "vera_console_handoff_v2" }))).toContain(
      "schema_version",
    );
  });

  it("rejects malformed evidence refs and keeps evidence claim-only", () => {
    const fields = invalidFields(
      validHandoff({
        evidence_refs: [
          {
            evidence_ref_id: "evidence-1",
            hash: "abc",
            verification_state: "verified",
          },
        ],
      }),
    );

    expect(fields).toContain("evidence_refs.0.hash_algorithm");
    expect(fields).toContain("evidence_refs.0.verification_state");
  });

  it("rejects malformed runtime-policy metadata", () => {
    const fields = invalidFields(
      validHandoff({
        runtime_policy_requirements: {
          requested_role: "console_default_worker",
          policy_version: "role_runtime_policy_v2.0",
          enforcement_mode: "active",
          privacy_level: "secret",
          fallback_allowed: "no",
        },
      }),
    );

    expect(fields).toContain("runtime_policy_requirements.requested_role");
    expect(fields).toContain("runtime_policy_requirements.policy_version");
    expect(fields).toContain("runtime_policy_requirements.enforcement_mode");
    expect(fields).toContain("runtime_policy_requirements.privacy_level");
    expect(fields).toContain("runtime_policy_requirements.fallback_allowed");
  });

  it("rejects malformed approval policy", () => {
    const fields = invalidFields(
      validHandoff({
        approval_policy: {
          implementation_requires_approval: false,
          apply_requires_approval: true,
          integration_requires_approval: true,
          main_tree_mutation_allowed: true,
        },
      }),
    );

    expect(fields).toContain("approval_policy.implementation_requires_approval");
    expect(fields).toContain("approval_policy.main_tree_mutation_allowed");
  });

  it("ignores unknown optional fields without authorizing behavior", () => {
    const result = validateVeraConsoleHandoffV1(
      validHandoff({
        executeRun: true,
        shell: "touch SHOULD_NOT_RUN",
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });
});
