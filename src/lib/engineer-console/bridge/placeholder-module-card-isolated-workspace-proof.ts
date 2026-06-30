import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER,
  VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  validateVeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardRequest,
} from "./placeholder-module-card-contract";

export const VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION =
  "vera_builder_loop_isolated_workspace_proof_v1" as const;
export const VERA_ISOLATED_WORKSPACE_TYPE = "system_created_temp_workspace" as const;

export type VeraIsolatedWorkspaceProofCheck = {
  name: string;
  status: "passed" | "failed";
  summary: string;
};

export type VeraIsolatedWorkspaceProofArtifact = {
  artifact_type: "placeholder_module_card";
  json_relative_path: "module-card.json";
  markdown_relative_path: "module-card.md";
  json_sha256: string;
  markdown_sha256: string;
  byte_count: number;
  generated_from_workspace_only: true;
};

export type VeraIsolatedWorkspaceMutationDenialProof = {
  normal_run_orchestrator_invoked: false;
  bound_repo_path_used: false;
  branch_created: false;
  commit_created: false;
  pr_created: false;
  deploy_triggered: false;
  merge_triggered: false;
  main_tree_mutated: false;
  production_data_used: false;
  arbitrary_command_accepted: false;
  arbitrary_path_accepted: false;
};

export type VeraIsolatedWorkspaceProofEvidence = {
  evidence_id: string;
  schema_version: typeof VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION;
  summary: string;
  workspace_type: typeof VERA_ISOLATED_WORKSPACE_TYPE;
  workspace_id: string;
  workspace_path_ref: string;
  workspace_retention: "cleaned_up" | "contained_for_test";
  workspace_exists_after_cleanup: boolean;
  artifact: VeraIsolatedWorkspaceProofArtifact;
  checks_run: VeraIsolatedWorkspaceProofCheck[];
  mutation_denial_proof: VeraIsolatedWorkspaceMutationDenialProof;
  final_integration_blocked_proof: {
    final_integration_authorized: false;
    final_integration_blocked_state: "final-integration-default-off";
    integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  };
  boundary_flags: {
    metadata_only: true;
    read_only: true;
    system_source_of_truth: true;
    console_metadata_authoritative: false;
    repo_mutation_authorized: false;
    branch_creation_authorized: false;
    commit_creation_authorized: false;
    pr_creation_authorized: false;
    deploy_authorized: false;
    merge_authorized: false;
    arbitrary_execution_authorized: false;
    arbitrary_filesystem_path_authorized: false;
  };
  operator_readable_summary: string;
};

export type VeraIsolatedWorkspaceProofResult = {
  ok: boolean;
  status: "isolated_workspace_proof_passed" | "rejected" | "failed";
  schema_version: typeof VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION;
  placeholder_schema_version: typeof VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION;
  canonical_owner: typeof VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER;
  console_boundary: typeof VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY;
  metadata_only: true;
  read_only: true;
  non_authoritative: true;
  errors: string[];
  warnings: string[];
  evidence?: VeraIsolatedWorkspaceProofEvidence;
  placeholder_artifact?: VeraPlaceholderModuleCardRequest;
  execution_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE;
  integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  final_integration_authorized: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  console_metadata_authoritative: false;
};

export type VeraIsolatedWorkspaceProofDeps = {
  tempRoot?: string;
  workspaceId?: () => string;
  cleanup?: boolean;
};

const WORKSPACE_PREFIX = "vera-builder-loop-isolated-";

function baseResult(input: {
  ok: boolean;
  status: VeraIsolatedWorkspaceProofResult["status"];
  errors?: string[];
  warnings?: string[];
  evidence?: VeraIsolatedWorkspaceProofEvidence;
  placeholder_artifact?: VeraPlaceholderModuleCardRequest;
}): VeraIsolatedWorkspaceProofResult {
  return {
    ok: input.ok,
    status: input.status,
    schema_version: VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION,
    placeholder_schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    canonical_owner: VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER,
    console_boundary: VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY,
    metadata_only: true,
    read_only: true,
    non_authoritative: true,
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.placeholder_artifact ? { placeholder_artifact: input.placeholder_artifact } : {}),
    execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
    integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    final_integration_authorized: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    console_metadata_authoritative: false,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceRef(workspacePath: string): string {
  return `sha256:${sha256(workspacePath)}`;
}

const REGISTRY_FIELD_DESCRIPTIONS: Record<string, string> = {
  module_name: "Human-readable VeraLux module name proposed by the operator.",
  purpose: "Why this module exists and what operational question it answers.",
  owner: "Human or team accountable for this module after future manual integration.",
  status: "Current proposal lifecycle state, such as proposed, approved, or request-changes.",
  evidence_state: "Whether supporting evidence exists and where it can be reviewed.",
  decision_state: "Operator decision state for this proposed artifact.",
  integration_state: "Integration posture; remains blocked/manual until a future integration workflow exists.",
  last_updated: "Last operator-reviewed or generated timestamp/date for the proposed record.",
  next_action: "Next manual action an operator should take.",
};

function requestedRegistryFieldKeys(request: VeraPlaceholderModuleCardRequest): string[] {
  const combined = [
    request.module_card_name,
    request.purpose,
    ...request.scope,
    ...request.constraints,
    ...request.risks,
    ...request.acceptance_criteria,
  ].join("\n").toLowerCase();
  const registryStyle = combined.includes("registry") || combined.includes("source of truth");
  const keys = Object.keys(REGISTRY_FIELD_DESCRIPTIONS).filter((key) => {
    const phrase = key.replace(/_/g, " ");
    return combined.includes(phrase) || combined.includes(key);
  });
  return registryStyle ? Array.from(new Set(["module_name", ...keys])) : keys;
}

function proposedRegistryFields(request: VeraPlaceholderModuleCardRequest): Record<string, string> | null {
  const keys = requestedRegistryFieldKeys(request);
  if (keys.length === 0) return null;
  const fields: Record<string, string> = {};
  for (const key of keys) {
    fields[key] = key === "module_name" ? request.module_card_name : REGISTRY_FIELD_DESCRIPTIONS[key] ?? key.replace(/_/g, " ");
  }
  return fields;
}

function safeWorkspaceId(deps: VeraIsolatedWorkspaceProofDeps): string {
  const raw = deps.workspaceId?.() ?? createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 12);
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "workspace";
}

function createWorkspace(deps: VeraIsolatedWorkspaceProofDeps): { workspacePath: string; workspaceId: string } {
  const parent = deps.tempRoot ?? os.tmpdir();
  const workspaceId = safeWorkspaceId(deps);
  const workspacePath = fs.mkdtempSync(path.join(parent, `${WORKSPACE_PREFIX}${workspaceId}-`));
  return { workspacePath, workspaceId };
}

function renderJsonArtifact(handoff: VeraPlaceholderModuleCardHandoff): string {
  const registryFields = proposedRegistryFields(handoff.request);
  return `${JSON.stringify({
    artifact_type: "placeholder_module_card",
    module_card_name: handoff.request.module_card_name,
    purpose: handoff.request.purpose,
    ...(registryFields ? { proposed_registry_fields: registryFields } : {}),
    scope: handoff.request.scope,
    constraints: handoff.request.constraints,
    risks: handoff.request.risks,
    acceptance_criteria: handoff.request.acceptance_criteria,
    integration_status: handoff.request.integration_status,
    generated_by: "engineering-console-isolated-workspace-proof",
    execution_mode: "metadata_only",
    final_integration_authorized: false,
    repo_mutation_authorized: false,
  }, null, 2)}\n`;
}

function renderMarkdownArtifact(handoff: VeraPlaceholderModuleCardHandoff): string {
  const registryFields = proposedRegistryFields(handoff.request);
  return [
    `# ${handoff.request.module_card_name}`,
    "",
    handoff.request.purpose,
    "",
    ...(registryFields
      ? [
          "## Proposed Registry Fields",
          ...Object.entries(registryFields).map(([key, description]) => `- **${key.replace(/_/g, " ")}**: ${description}`),
          "",
        ]
      : []),
    "## Scope",
    ...handoff.request.scope.map((item) => `- ${item}`),
    "",
    "## Acceptance Criteria",
    ...handoff.request.acceptance_criteria.map((item) => `- ${item}`),
    "",
    "## Boundary",
    "- Metadata-only placeholder artifact.",
    "- No branch, commit, PR, deploy, merge, repo mutation, or final integration authorized.",
    "",
  ].join("\n");
}

function validateWorkspaceArtifact(input: {
  workspacePath: string;
  jsonPath: string;
  markdownPath: string;
  handoff: VeraPlaceholderModuleCardHandoff;
}): VeraIsolatedWorkspaceProofCheck[] {
  const checks: VeraIsolatedWorkspaceProofCheck[] = [];
  try {
    const resolvedJson = path.resolve(input.jsonPath);
    const resolvedMarkdown = path.resolve(input.markdownPath);
    const resolvedWorkspace = path.resolve(input.workspacePath);
    const contained =
      resolvedJson.startsWith(`${resolvedWorkspace}${path.sep}`) &&
      resolvedMarkdown.startsWith(`${resolvedWorkspace}${path.sep}`);
    checks.push({
      name: "workspace_containment",
      status: contained ? "passed" : "failed",
      summary: contained
        ? "Generated artifacts are contained inside the system-created temp workspace."
        : "Generated artifacts escaped the system-created temp workspace.",
    });

    const parsed = JSON.parse(fs.readFileSync(input.jsonPath, "utf8")) as Record<string, unknown>;
    const jsonValid =
      parsed.artifact_type === "placeholder_module_card" &&
      parsed.module_card_name === input.handoff.request.module_card_name &&
      parsed.execution_mode === "metadata_only" &&
      parsed.final_integration_authorized === false &&
      parsed.repo_mutation_authorized === false;
    checks.push({
      name: "placeholder_json_validation",
      status: jsonValid ? "passed" : "failed",
      summary: jsonValid
        ? "Placeholder JSON artifact is parseable and preserves non-authorizing flags."
        : "Placeholder JSON artifact failed validation.",
    });

    const markdown = fs.readFileSync(input.markdownPath, "utf8");
    const markdownValid =
      markdown.includes(input.handoff.request.module_card_name) &&
      markdown.includes("No branch, commit, PR, deploy, merge, repo mutation, or final integration authorized.");
    checks.push({
      name: "operator_readable_markdown_validation",
      status: markdownValid ? "passed" : "failed",
      summary: markdownValid
        ? "Markdown artifact is operator readable and includes the safety boundary."
        : "Markdown artifact is missing operator-readable safety content.",
    });
  } catch (error) {
    checks.push({
      name: "isolated_workspace_validation_error",
      status: "failed",
      summary: error instanceof Error ? error.message : String(error),
    });
  }
  return checks;
}

function mutationDenialProof(): VeraIsolatedWorkspaceMutationDenialProof {
  return {
    normal_run_orchestrator_invoked: false,
    bound_repo_path_used: false,
    branch_created: false,
    commit_created: false,
    pr_created: false,
    deploy_triggered: false,
    merge_triggered: false,
    main_tree_mutated: false,
    production_data_used: false,
    arbitrary_command_accepted: false,
    arbitrary_path_accepted: false,
  };
}

export function runVeraPlaceholderModuleCardIsolatedWorkspaceProof(
  raw: unknown,
  deps: VeraIsolatedWorkspaceProofDeps = {},
): VeraIsolatedWorkspaceProofResult {
  const validation = validateVeraPlaceholderModuleCardHandoff(raw);
  if (!validation.ok || !validation.placeholder_artifact) {
    return baseResult({
      ok: false,
      status: "rejected",
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const handoff = raw as VeraPlaceholderModuleCardHandoff;
  const cleanup = deps.cleanup !== false;
  const { workspacePath, workspaceId } = createWorkspace(deps);
  const jsonPath = path.join(workspacePath, "module-card.json");
  const markdownPath = path.join(workspacePath, "module-card.md");

  try {
    const jsonArtifact = renderJsonArtifact(handoff);
    const markdownArtifact = renderMarkdownArtifact(handoff);
    fs.writeFileSync(jsonPath, jsonArtifact, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(markdownPath, markdownArtifact, { encoding: "utf8", mode: 0o600 });

    const checks = validateWorkspaceArtifact({ workspacePath, jsonPath, markdownPath, handoff });
    const artifact: VeraIsolatedWorkspaceProofArtifact = {
      artifact_type: "placeholder_module_card",
      json_relative_path: "module-card.json",
      markdown_relative_path: "module-card.md",
      json_sha256: sha256(fs.readFileSync(jsonPath, "utf8")),
      markdown_sha256: sha256(fs.readFileSync(markdownPath, "utf8")),
      byte_count: fs.statSync(jsonPath).size + fs.statSync(markdownPath).size,
      generated_from_workspace_only: true,
    };
    const passed = checks.every((check) => check.status === "passed");

    if (cleanup) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    const evidence: VeraIsolatedWorkspaceProofEvidence = {
      evidence_id: `isolated-workspace-proof-${sha256(`${workspaceId}:${artifact.json_sha256}:${artifact.markdown_sha256}`).slice(0, 16)}`,
      schema_version: VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION,
      summary: passed
        ? `Console generated and validated a placeholder module card inside a system-created temp workspace for "${handoff.request.module_card_name}".`
        : "Console isolated workspace proof failed one or more internal checks.",
      workspace_type: VERA_ISOLATED_WORKSPACE_TYPE,
      workspace_id: workspaceId,
      workspace_path_ref: workspaceRef(workspacePath),
      workspace_retention: cleanup ? "cleaned_up" : "contained_for_test",
      workspace_exists_after_cleanup: fs.existsSync(workspacePath),
      artifact,
      checks_run: checks,
      mutation_denial_proof: mutationDenialProof(),
      final_integration_blocked_proof: {
        final_integration_authorized: false,
        final_integration_blocked_state: "final-integration-default-off",
        integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
      },
      boundary_flags: {
        metadata_only: true,
        read_only: true,
        system_source_of_truth: true,
        console_metadata_authoritative: false,
        repo_mutation_authorized: false,
        branch_creation_authorized: false,
        commit_creation_authorized: false,
        pr_creation_authorized: false,
        deploy_authorized: false,
        merge_authorized: false,
        arbitrary_execution_authorized: false,
        arbitrary_filesystem_path_authorized: false,
      },
      operator_readable_summary: [
        "Isolated workspace proof completed without using the normal Console run/orchestrator path.",
        "The generated placeholder artifact was contained to a system-created temp workspace.",
        "No bound repo mutation, branch, commit, PR, deploy, merge, or final integration was authorized.",
      ].join(" "),
    };

    return baseResult({
      ok: passed,
      status: passed ? "isolated_workspace_proof_passed" : "failed",
      errors: passed ? [] : checks.filter((check) => check.status === "failed").map((check) => check.summary),
      warnings: [
        "This proof covers a dedicated isolated temp workspace path only; the normal Console run/orchestrator remains blocked for Vera Builder Loop execution.",
        "Console evidence is non-authoritative where System owns Vera-side source-of-truth state.",
      ],
      evidence,
      placeholder_artifact: validation.placeholder_artifact,
    });
  } catch (error) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return baseResult({
      ok: false,
      status: "failed",
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [
        "Isolated workspace proof failed before evidence could be completed.",
      ],
      placeholder_artifact: validation.placeholder_artifact,
    });
  }
}
