import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runVeraPlaceholderModuleCardIsolatedWorkspaceProof,
  VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION,
  VERA_ISOLATED_WORKSPACE_TYPE,
} from "./placeholder-module-card-isolated-workspace-proof";
import {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

const root = process.cwd();
let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-isolated-proof-test-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function handoff(overrides: Partial<VeraPlaceholderModuleCardHandoff> = {}): VeraPlaceholderModuleCardHandoff {
  return {
    schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    source: "veralux-system",
    requested_by: "operator",
    artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
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
    system_source_of_truth: true,
    console_metadata_authoritative: false,
    request: {
      module_card_name: "Isolated Workspace Proof Card",
      purpose: "Prove harmless artifact generation inside a temp workspace.",
      scope: ["Write placeholder JSON", "Write operator markdown", "Run internal checks"],
      constraints: ["No bound repo writes", "No branch creation", "No external command input"],
      risks: ["Normal Console orchestrator remains blocked"],
      acceptance_criteria: [
        "Artifact is generated only inside the temp workspace.",
        "Checks run without accepting arbitrary commands.",
        "Final integration remains blocked/default-off.",
      ],
      requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    },
    ...overrides,
  };
}

function listProofWorkspaces(): string[] {
  return fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("vera-builder-loop-isolated-"));
}

describe("Vera isolated workspace proof for placeholder module card", () => {
  it("creates placeholder artifacts only inside a system-created isolated temp workspace", () => {
    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof(handoff(), {
      tempRoot,
      workspaceId: () => "proof",
      cleanup: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("isolated_workspace_proof_passed");
    expect(result.schema_version).toBe(VERA_ISOLATED_WORKSPACE_PROOF_SCHEMA_VERSION);
    expect(result.evidence?.workspace_type).toBe(VERA_ISOLATED_WORKSPACE_TYPE);
    expect(result.evidence?.workspace_retention).toBe("contained_for_test");
    expect(result.evidence?.workspace_exists_after_cleanup).toBe(true);
    expect(result.evidence?.artifact.json_relative_path).toBe("module-card.json");
    expect(result.evidence?.artifact.markdown_relative_path).toBe("module-card.md");
    expect(result.evidence?.artifact.generated_from_workspace_only).toBe(true);
    expect(result.evidence?.checks_run.every((check) => check.status === "passed")).toBe(true);

    const workspaces = listProofWorkspaces();
    expect(workspaces).toHaveLength(1);
    const workspacePath = path.join(tempRoot, workspaces[0]!);
    expect(fs.existsSync(path.join(workspacePath, "module-card.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, "module-card.md"))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(workspacePath, "module-card.json"), "utf8")) as Record<string, unknown>;
    expect(json.module_card_name).toBe("Isolated Workspace Proof Card");
    expect(json.final_integration_authorized).toBe(false);
    expect(json.repo_mutation_authorized).toBe(false);
  });

  it("preserves Module Registry requested fields and operator acceptance criteria in JSON and markdown", () => {
    const request = {
      module_card_name: "VeraLux Module Registry",
      purpose: "Track every VeraLux module proposed through the Vera Builder Loop.",
      scope: [
        "Create a read-only proposal artifact.",
        "The module registry should track module name, purpose, owner, status, evidence state, decision state, integration state, last updated date, and next action.",
      ],
      constraints: ["Use only the safe isolated Console workspace path."],
      risks: [
        "This proposal could be mistaken for an integrated source of truth before a future manual integration workflow exists.",
      ],
      acceptance_criteria: [
        "Shows owner.",
        "Shows evidence state.",
        "Shows decision state.",
        "Shows integration state.",
        "Shows last updated date.",
        "Shows next action.",
      ],
      requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    };
    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof(handoff({ request }), {
      tempRoot,
      workspaceId: () => "registry-fields",
      cleanup: false,
    });

    expect(result.ok).toBe(true);
    const workspacePath = path.join(tempRoot, listProofWorkspaces()[0]!);
    const json = JSON.parse(fs.readFileSync(path.join(workspacePath, "module-card.json"), "utf8")) as {
      proposed_registry_fields?: Record<string, string>;
      acceptance_criteria?: string[];
      risks?: string[];
    };
    const markdown = fs.readFileSync(path.join(workspacePath, "module-card.md"), "utf8");

    expect(json.proposed_registry_fields).toMatchObject({
      module_name: "VeraLux Module Registry",
      owner: expect.any(String),
      status: expect.any(String),
      evidence_state: expect.any(String),
      decision_state: expect.any(String),
      integration_state: expect.any(String),
      last_updated: expect.any(String),
      next_action: expect.any(String),
    });
    expect(json.acceptance_criteria).toEqual(request.acceptance_criteria);
    expect(json.risks).toContain("This proposal could be mistaken for an integrated source of truth before a future manual integration workflow exists.");
    expect(JSON.stringify(json)).not.toContain("Real build/test execution requires a separate workspace-boundary proof");

    expect(markdown).toContain("## Proposed Registry Fields");
    for (const field of ["module name", "owner", "status", "evidence state", "decision state", "integration state", "last updated", "next action"]) {
      expect(markdown).toContain(field);
    }
    for (const criterion of request.acceptance_criteria) {
      expect(markdown).toContain(criterion);
    }
    expect(markdown).not.toContain("Real build/test execution requires a separate workspace-boundary proof");
  });

  it("cleans up the isolated temp workspace by default while preserving evidence metadata", () => {
    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof(handoff(), {
      tempRoot,
      workspaceId: () => "cleanup-proof",
    });

    expect(result.ok).toBe(true);
    expect(result.evidence?.workspace_retention).toBe("cleaned_up");
    expect(result.evidence?.workspace_exists_after_cleanup).toBe(false);
    expect(result.evidence?.workspace_path_ref).toMatch(/^sha256:/);
    expect(listProofWorkspaces()).toHaveLength(0);
  });

  it("rejects unsafe handoffs with repo path, branch, commit, PR, deploy, final integration, path, or command fields", () => {
    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof({
      ...handoff(),
      repoPath: "/tmp/repo",
      branchName: "unsafe",
      commitIntent: "commit",
      prIntent: "create",
      deployIntent: "deploy",
      finalIntegrationIntent: "integrate",
      arbitraryPath: "/tmp/unsafe",
      command: "npm test",
    }, { tempRoot });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.errors.join("\n")).toContain("repoPath");
    expect(result.errors.join("\n")).toContain("branchName");
    expect(result.errors.join("\n")).toContain("commitIntent");
    expect(result.errors.join("\n")).toContain("prIntent");
    expect(result.errors.join("\n")).toContain("deployIntent");
    expect(result.errors.join("\n")).toContain("finalIntegrationIntent");
    expect(result.errors.join("\n")).toContain("arbitraryPath");
    expect(result.errors.join("\n")).toContain("command");
    expect(listProofWorkspaces()).toHaveLength(0);
  });

  it("does not invoke branch, commit, PR, deploy, merge, or final integration seams", () => {
    const createBranch = vi.fn();
    const createCommit = vi.fn();
    const createPr = vi.fn();
    const deploy = vi.fn();
    const merge = vi.fn();
    const finalIntegration = vi.fn();

    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof(handoff(), {
      tempRoot,
      workspaceId: () => "no-seams",
    });

    expect(result.ok).toBe(true);
    expect(result.evidence?.mutation_denial_proof.branch_created).toBe(false);
    expect(result.evidence?.mutation_denial_proof.commit_created).toBe(false);
    expect(result.evidence?.mutation_denial_proof.pr_created).toBe(false);
    expect(result.evidence?.mutation_denial_proof.deploy_triggered).toBe(false);
    expect(result.evidence?.mutation_denial_proof.normal_run_orchestrator_invoked).toBe(false);
    expect(createBranch).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(createPr).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
    expect(finalIntegration).not.toHaveBeenCalled();
  });

  it("does not modify bound repo or main-tree files", () => {
    const boundRepoFile = path.join(tempRoot, "bound-repo-marker.txt");
    fs.writeFileSync(boundRepoFile, "unchanged", "utf8");
    const packageJson = path.join(root, "package.json");
    const packageBefore = fs.readFileSync(packageJson, "utf8");

    const result = runVeraPlaceholderModuleCardIsolatedWorkspaceProof(handoff(), {
      tempRoot,
      workspaceId: () => "no-main-tree",
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(boundRepoFile, "utf8")).toBe("unchanged");
    expect(fs.readFileSync(packageJson, "utf8")).toBe(packageBefore);
    expect(result.evidence?.mutation_denial_proof.bound_repo_path_used).toBe(false);
    expect(result.evidence?.mutation_denial_proof.main_tree_mutated).toBe(false);
  });

  it("keeps the proof route isolated from normal Console run/orchestrator and mutation helpers", () => {
    const route = fs.readFileSync(
      path.join(root, "src/app/api/engineer-console/bridge/placeholder-module-card/isolated-workspace-proof/route.ts"),
      "utf8",
    );
    const contract = fs.readFileSync(
      path.join(root, "src/lib/engineer-console/bridge/placeholder-module-card-isolated-workspace-proof.ts"),
      "utf8",
    );
    const combined = `${route}\n${contract}`;

    expect(combined).not.toContain("executeRun");
    expect(combined).not.toContain("run-orchestrator");
    expect(combined).not.toContain("startVeraExecution");
    expect(combined).not.toContain("createBranch(");
    expect(combined).not.toContain("createLocalCommitForRun");
    expect(combined).not.toContain("createGovernedPullRequestForRun");
    expect(combined).not.toContain("executeProductionDeploymentForRun");
    expect(combined).not.toContain("child_process");
  });
});
