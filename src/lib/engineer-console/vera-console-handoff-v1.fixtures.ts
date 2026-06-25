export const canonicalVeraConsoleHandoffV1Fixture = {
  schema_version: "vera_console_handoff_v1",
  request_id: "vc-handoff-2026-06-25-prototype-pricing-summary",
  user_intent:
    "Build a governed prototype that summarizes pricing export readiness without changing production files.",
  task_lane: "prototype_loop_v1",
  build_scope: {
    target_repo: "Veralux-System",
    allowed_paths: [
      ".prototype-loop/<task-id>/",
      "evidence/prototype-loop-v1/<task-id>.json",
    ],
    disallowed_paths: [
      "src/**",
      "public/**",
      "scripts/deploy-*.sh",
      "main working tree",
    ],
    mutation_allowed: false,
  },
  acceptance_criteria: [
    "Prototype output is created only inside an isolated prototype workspace.",
    "Evidence artifact records files changed, checks run, and approval requirements.",
    "No implementation, apply, integration, merge, deploy, push, PR, or commit is authorized.",
  ],
  constraints: [
    "Treat evidence references as unverified claims until Phase 5 rehydration.",
    "Treat runtime-policy metadata as structural metadata only.",
    "Require later explicit approval before implementation, apply, or integration.",
    "Keep main_tree_mutation_allowed false.",
  ],
  risk_level: "low",
  evidence_refs: [
    {
      evidence_ref_id: "evidence-prototype-loop-v1-pricing-summary",
      evidence_type: "prototype_loop_evidence",
      path_or_uri: "evidence/prototype-loop-v1/pricing-summary.json",
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      hash_algorithm: "sha256",
      verification_state: "claim_unverified",
    },
  ],
  source_context_refs: [
    {
      source_context_id: "source-work-order-pricing-summary",
      source_type: "vera_work_order",
      ref: "work-order:pricing-summary-readiness",
      description: "Source Vera work order or conversational plan that requested the prototype.",
    },
    {
      source_context_id: "source-runtime-policy-shadow",
      source_type: "runtime_policy_audit_ref",
      ref: "runtime-policy-shadow:vc-handoff-2026-06-25",
      description: "Optional runtime-policy shadow/parity/simulation reference, not proof.",
    },
  ],
  requested_role: "vera_build_router",
  runtime_policy_requirements: {
    requested_role: "vera_build_router",
    policy_version: "role_runtime_policy_v1.0",
    enforcement_mode: "parity",
    risk_level: "low",
    privacy_level: "low",
    fallback_allowed: false,
    cloud_allowed: false,
    requires_audit_record: true,
    decision_audit_ref: "runtime-policy-shadow:vc-handoff-2026-06-25",
    compliance_note:
      "Runtime-policy metadata is structural only until downstream verification.",
  },
  approval_policy: {
    implementation_requires_approval: true,
    apply_requires_approval: true,
    integration_requires_approval: true,
    main_tree_mutation_allowed: false,
    approver_role_required: "operator",
  },
  created_at: "2026-06-25T15:15:00.000Z",
} as const;

export const missingRequiredVeraConsoleHandoffV1Fixture = {
  ...canonicalVeraConsoleHandoffV1Fixture,
  request_id: "",
} as const;

export const unsupportedVersionVeraConsoleHandoffV1Fixture = {
  ...canonicalVeraConsoleHandoffV1Fixture,
  schema_version: "vera_console_handoff_v2",
} as const;

export const malformedEvidenceVeraConsoleHandoffV1Fixture = {
  ...canonicalVeraConsoleHandoffV1Fixture,
  evidence_refs: [
    {
      evidence_ref_id: "evidence-with-unsupported-verification-state",
      path_or_uri: "evidence/prototype-loop-v1/pricing-summary.json",
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      verification_state: "verified",
    },
  ],
} as const;

export const malformedRuntimePolicyVeraConsoleHandoffV1Fixture = {
  ...canonicalVeraConsoleHandoffV1Fixture,
  runtime_policy_requirements: {
    requested_role: "console_default_worker",
    policy_version: "role_runtime_policy_v2.0",
    enforcement_mode: "active",
    risk_level: "medium",
    privacy_level: "secret",
    fallback_allowed: "no",
  },
} as const;

export const unsafeApprovalVeraConsoleHandoffV1Fixture = {
  ...canonicalVeraConsoleHandoffV1Fixture,
  approval_policy: {
    implementation_requires_approval: true,
    apply_requires_approval: false,
    integration_requires_approval: true,
    main_tree_mutation_allowed: true,
  },
} as const;
