import {
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY,
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY,
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE,
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION,
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER,
} from "./vera-final-integration-workflow-smoke-mirror-contract";

const baseMirror = {
  schema_version: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION,
  canonical_owner: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER,
  console_boundary: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY,
  console_validation_status: "accepted_metadata_only",
  non_authoritative: true,
  read_only: true,
  metadata_only: true,
  current_final_integration_boundary: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY,
  intended_future_vehicle: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE,
  audit_event_id: "final-integration-audit-console-mirror-12i",
  rollback_abort_event_id: "rollback-abort-console-mirror-12i",
  github_pr_transport_design_id: "github-pr-transport-console-mirror-12i",
  dry_run_readiness_id: "dry-run-readiness-console-mirror-12i",
  workflow_dry_run_contract_id: "workflow-dry-run-console-mirror-12i",
  vera_handoff_id: "vera-handoff-console-mirror-12i",
  candidate_id: "candidate-console-mirror-12i",
  evidence_bundle_metadata: "evidence-bundle-console-mirror-12i",
  evidence_verification_status: "verified-metadata-only",
  runtime_policy_audit_id: "runtime-policy-audit-console-mirror-12i",
  approval_state: "approved-metadata-only",
  integration_state: "blocked-default-off",
  dry_run_blocked_default_off_state: "dry-run-default-off",
  final_integration_blocked_default_off_state: "final-integration-default-off",
  unsafe_material_absent: true,
  dry_run_execution_allowed: false,
  mutation_allowed: false,
  git_mutation_allowed: false,
  pr_mutation_allowed: false,
  pr_creation_allowed: false,
  branch_creation_allowed: false,
  commit_creation_allowed: false,
  filesystem_write_allowed: false,
  main_tree_mutation_allowed: false,
  console_mutation_allowed: false,
  rollback_execution_allowed: false,
  abort_execution_allowed: false,
  final_integration_authority: false,
} as const;

export const validFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
} as const;

export const blockedFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  approval_state: "approval-required",
  evidence_verification_status: "verification-required",
} as const;

export const rejectedUnsafeFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  console_validation_status: "rejected_unsafe",
  unsafe_material_absent: false,
} as const;

export const mutationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  mutation_allowed: Boolean("unsafe"),
} as const;

export const finalIntegrationAuthorityFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  final_integration_authority: Boolean("unsafe"),
} as const;

export const gitPrAuthorityFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  pr_creation_allowed: Boolean("unsafe"),
} as const;

export const filesystemAuthorityFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  filesystem_write_allowed: Boolean("unsafe"),
} as const;

export const rollbackExecutionAuthorityFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  rollback_execution_allowed: Boolean("unsafe"),
} as const;

export const secretBearingFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  github_token: "ghp_unsafe",
} as const;

export const rawPatchFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  raw_patch_payload: "diff --git a/file b/file",
} as const;

export const commandBearingFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  executable_git_command: "git push origin main",
} as const;

export const unrestrictedPathFinalIntegrationWorkflowSmokeMirrorFixture = {
  ...baseMirror,
  unrestricted_local_path: "/tmp/patch.diff",
} as const;
