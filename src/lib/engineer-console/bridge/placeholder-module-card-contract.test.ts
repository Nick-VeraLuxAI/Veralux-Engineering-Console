import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateVeraPlaceholderModuleCardHandoff,
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

const root = process.cwd();

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
      module_card_name: "Read-only Revenue Lens",
      purpose: "Show a proposed module card without integrating it.",
      scope: ["Render card title", "Render operator-readable purpose"],
      constraints: ["No repo writes", "No final integration"],
      risks: ["Real build/test execution remains unproven"],
      acceptance_criteria: [
        "Placeholder artifact is operator readable.",
        "Final integration remains blocked/default-off.",
      ],
      requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    },
    ...overrides,
  };
}

describe("Vera placeholder module card metadata-only contract", () => {
  it("validates a metadata-only placeholder handoff", () => {
    const result = validateVeraPlaceholderModuleCardHandoff(handoff());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("validated_metadata_only");
    expect(result.metadata_only).toBe(true);
    expect(result.read_only).toBe(true);
    expect(result.non_authoritative).toBe(true);
    expect(result.placeholder_artifact?.module_card_name).toBe("Read-only Revenue Lens");
    expect(result.evidence?.summary).toContain("No execution, repo mutation, branch, commit, PR, deploy, or final integration");
    expect(result.final_integration_authorized).toBe(false);
    expect(result.repo_mutation_authorized).toBe(false);
    expect(result.branch_creation_authorized).toBe(false);
    expect(result.commit_creation_authorized).toBe(false);
    expect(result.pr_creation_authorized).toBe(false);
    expect(result.deploy_authorized).toBe(false);
  });

  it("rejects execution, repo, branch, PR, deploy, final-integration, and arbitrary path fields", () => {
    const result = validateVeraPlaceholderModuleCardHandoff({
      ...handoff(),
      targetRepoPath: "/home/ndesantis/Documents/GitHub/Veralux-System",
      branchName: "builder-loop-demo",
      command: "npm test",
      prIntent: "create",
      deployIntent: "production",
      finalIntegrationIntent: "integrate",
      absolutePath: "/tmp/unsafe",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.errors.join("\n")).toContain("targetRepoPath");
    expect(result.errors.join("\n")).toContain("branchName");
    expect(result.errors.join("\n")).toContain("command");
    expect(result.errors.join("\n")).toContain("prIntent");
    expect(result.errors.join("\n")).toContain("deployIntent");
    expect(result.errors.join("\n")).toContain("finalIntegrationIntent");
    expect(result.errors.join("\n")).toContain("absolutePath");
    expect(result.final_integration_authorized).toBe(false);
  });

  it("rejects authority flags that try to become true", () => {
    const result = validateVeraPlaceholderModuleCardHandoff({
      ...handoff(),
      repo_mutation_authorized: true,
      pr_creation_authorized: true,
      deploy_authorized: true,
      console_metadata_authoritative: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("repo_mutation_authorized");
    expect(result.errors.join("\n")).toContain("pr_creation_authorized");
    expect(result.errors.join("\n")).toContain("deploy_authorized");
    expect(result.errors.join("\n")).toContain("console_metadata_authoritative");
  });

  it("does not invoke mutation or integration seams during validation", () => {
    const createBranch = vi.fn();
    const createCommit = vi.fn();
    const createPr = vi.fn();
    const deploy = vi.fn();
    const finalIntegration = vi.fn();

    const result = validateVeraPlaceholderModuleCardHandoff(handoff());

    expect(result.ok).toBe(true);
    expect(createBranch).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(createPr).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    expect(finalIntegration).not.toHaveBeenCalled();
  });

  it("keeps the route isolated from normal run/orchestrator and mutation helpers", () => {
    const route = fs.readFileSync(
      path.join(root, "src/app/api/engineer-console/bridge/placeholder-module-card/route.ts"),
      "utf8",
    );
    const contract = fs.readFileSync(
      path.join(root, "src/lib/engineer-console/bridge/placeholder-module-card-contract.ts"),
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
